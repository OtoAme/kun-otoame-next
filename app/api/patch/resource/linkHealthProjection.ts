import { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import { LINK_HEALTH_POLICY, LINK_HEALTH_STATES } from '~/constants/linkHealth'
import { CASE_UNRESOLVED_STATUSES } from '~/constants/case'
import {
  linkCaseContextSchema,
  linkCheckSnapshotSchema
} from '~/validations/linkHealth'
import {
  canCheckResourceLink,
  canManageResource,
  canManageResourceLink
} from '~/components/patch/resource/resourcePermissions'
import { prepareLinkCheckInput } from './link-check/checker'
import { maintenanceRestriction } from './maintenance/policy'
import type {
  LinkCheckProvider,
  LinkDisputeSource,
  LinkHealth,
  LinkHealthSummary
} from '~/types/api/linkHealth'

export type LinkHealthViewer = { uid: number; role: number }

export const linkHealthSelect = (now = new Date()) =>
  ({
    id: true,
    storage: true,
    size: true,
    hash: true,
    content: true,
    code: true,
    password: true,
    sort_order: true,
    download: true,
    health: true,
    version: true,
    evidence_round: true,
    health_changed_at: true,
    verified_at: true,
    content_changed_at: true,
    check: true,
    reports: {
      where: {
        created: {
          gte: new Date(now.getTime() - LINK_HEALTH_POLICY.reportWindowMs)
        }
      },
      select: { user_id: true, link_version: true }
    },
    maintenance_controls: {
      select: {
        link_version: true,
        revision: true,
        frozen: true,
        events: {
          where: { active_key: { not: null } },
          select: { state: true, snoozed_until: true }
        }
      }
    }
  }) satisfies Prisma.patch_resource_linkSelect

type CurrentHealthLinkRow = Prisma.patch_resource_linkGetPayload<{
  select: ReturnType<typeof linkHealthSelect>
}>
export type HealthLinkRow = Omit<
  CurrentHealthLinkRow,
  'maintenance_controls'
> & {
  maintenance_controls?: CurrentHealthLinkRow['maintenance_controls']
}
type ContextLink = Pick<
  HealthLinkRow,
  'id' | 'health' | 'version' | 'evidence_round' | 'health_changed_at'
> & { resourceId: number; patchId: number }
const iso = (value: Date | null) => value?.toISOString() ?? null

/** The exact input identity shared by snapshot readers and later adapters. */
export const getLinkCheckInputSignature = (
  link: Pick<HealthLinkRow, 'storage' | 'content' | 'code'>,
  provider: LinkCheckProvider | null
) => {
  const prepared = prepareLinkCheckInput(link)
  return prepared.provider === provider ? prepared.inputSignature : ''
}

/** Select the latest *present* context, including malformed/null values. */
export const getLinkDisputeSources = async (
  links: ContextLink[],
  db: Pick<Prisma.TransactionClient, '$queryRaw'> = prisma
) => {
  const disputed = links.filter((link) => link.health === 'disputed')
  const sources = new Map<number, LinkDisputeSource>()
  if (!disputed.length) return sources
  const rows = await db.$queryRaw<
    { target_id: number; context: Prisma.JsonValue }[]
  >(Prisma.sql`
    SELECT c.target_id, m.payload->'link_health' AS context
    FROM ops_case c
    JOIN LATERAL (
      SELECT payload FROM ops_case_message
      WHERE case_id=c.id AND kind='system' AND payload ? 'link_health'
      ORDER BY created DESC, id DESC LIMIT 1
    ) m ON true
    WHERE c.target_type='link' AND c.target_id IN (${Prisma.join(disputed.map((link) => link.id))})
      AND c.kind IN ('link_suspect','link_disputed')
      AND c.status IN (${Prisma.join([...CASE_UNRESOLVED_STATUSES])})
  `)
  for (const row of rows) {
    const link = disputed.find((item) => item.id === row.target_id)
    const decoded = linkCaseContextSchema.safeParse(row.context)
    if (!link || !decoded.success) continue
    const context = decoded.data
    if (
      context.health === 'disputed' &&
      context.linkId === link.id &&
      context.linkVersion === link.version &&
      context.evidenceRound === link.evidence_round &&
      context.resourceId === link.resourceId &&
      context.patchId === link.patchId &&
      context.healthChangedAt === iso(link.health_changed_at)
    ) {
      sources.set(link.id, context.source)
    }
  }
  return sources
}

export const projectLinkHealth = (
  link: HealthLinkRow,
  resourceUserId: number,
  viewer: LinkHealthViewer | undefined,
  disputeSource: LinkDisputeSource | null = null,
  now = new Date()
): LinkHealthSummary => {
  const health: LinkHealth = LINK_HEALTH_STATES.includes(
    link.health as LinkHealth
  )
    ? (link.health as LinkHealth)
    : 'ok'
  const permission = {
    storage: link.storage,
    content: link.content,
    resourceUserId,
    userId: viewer?.uid ?? 0,
    userRole: viewer?.role ?? 0
  }
  const isOwner = canManageResourceLink(permission)
  const canVerify =
    (health === 'suspect' || health === 'broken') &&
    (link.verified_at === null ||
      now.getTime() - link.verified_at.getTime() >=
        LINK_HEALTH_POLICY.verificationIntervalMs)
  let latestCheck: LinkHealthSummary['latestCheck'] = null
  const check = link.check
  if (check && check.link_version === link.version) {
    const decoded = linkCheckSnapshotSchema.safeParse({
      requestId: check.request_id,
      inputSignature: check.input_signature,
      basis: {
        linkId: link.id,
        patchId: check.patch_id,
        resourceId: check.resource_id,
        linkVersion: check.link_version,
        evidenceRound: check.evidence_round,
        health: check.health,
        healthChangedAt: iso(check.health_changed_at)
      },
      requestedAt: iso(check.requested_at),
      completedAt: iso(check.completed_at),
      checkedAt: iso(check.checked_at),
      verdict: check.verdict,
      provider: check.provider,
      reason: check.reason,
      cached: check.cached,
      failed: check.failed
    })
    if (
      decoded.success &&
      decoded.data.inputSignature ===
        getLinkCheckInputSignature(link, decoded.data.provider)
    ) {
      const value = decoded.data
      const common = {
        attemptedAt: value.requestedAt,
        stale:
          value.checkedAt !== null &&
          now.getTime() - Date.parse(value.checkedAt) >=
            LINK_HEALTH_POLICY.checkDisplayTtlMs
      }
      latestCheck = value.failed
        ? {
            ...common,
            verdict: 'unknown',
            provider: value.provider,
            reason: value.reason,
            failed: true,
            checkedAt: null
          }
        : ({
            ...common,
            verdict: value.verdict,
            provider: value.provider,
            reason: value.reason,
            failed: false,
            checkedAt: value.checkedAt
          } as LinkHealthSummary['latestCheck'])
    }
  }
  return {
    maintenance: maintenanceRestriction(
      link.maintenance_controls?.find(
        (control) => control.link_version === link.version
      ),
      now
    ),
    version: link.version,
    evidenceRound: link.evidence_round,
    health,
    healthChangedAt: iso(link.health_changed_at),
    verifiedAt: iso(link.verified_at),
    lastRelinkAt: iso(link.content_changed_at),
    ownerType:
      link.storage === LINK_HEALTH_POLICY.staffStorage ? 'staff' : 'publisher',
    disputeSource: health === 'disputed' ? disputeSource : null,
    recentReportCount: new Set(
      link.reports
        .filter((report) => report.link_version === link.version)
        .map((report) => report.user_id)
    ).size,
    latestCheck,
    capabilities: {
      ownerActions: isOwner
        ? [
            ...(canVerify ? ['verify' as const] : []),
            ...(health === 'suspect' ? ['confirm_broken' as const] : [])
          ]
        : [],
      resolveActions:
        viewer &&
        viewer.uid > 0 &&
        viewer.role >= LINK_HEALTH_POLICY.staffMinRole &&
        health === 'disputed'
          ? ['available', 'broken']
          : [],
      canCheck: canCheckResourceLink(permission),
      canEdit: permission.userId > 0 && canManageResource(permission)
    }
  }
}
