import { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import { linkCaseContextSchema } from '~/validations/linkHealth'
import { LINK_MAINTENANCE_ERRORS as E } from '~/constants/linkMaintenance'
import { ResourceMutationError } from '../mutation'
import {
  linkHealthSelect,
  projectLinkHealth,
  getLinkDisputeSources
} from '../linkHealthProjection'
import {
  maintenanceActions,
  maintenanceRestriction,
  maintenanceState
} from './policy'
import type {
  WorkspaceMaintenanceQuery,
  WorkspaceUser
} from '~/types/api/workspace'
import type { LinkTarget } from '~/types/api/linkHealth'
import type {
  LinkMaintenanceItem,
  LinkMaintenanceListResponse,
  LinkMaintenanceOutcome
} from '~/types/api/linkMaintenance'

export const maintenanceInclude = {
  events: {
    orderBy: { round: 'desc' as const },
    take: 1,
    include: { _count: { select: { participants: true } } }
  }
} satisfies Prisma.patch_resource_link_maintenanceInclude

export const getMaintenanceControl = (
  db: Pick<Prisma.TransactionClient, 'patch_resource_link_maintenance'>,
  linkId: number,
  linkVersion: number
) =>
  db.patch_resource_link_maintenance.findUnique({
    where: {
      original_link_id_link_version: {
        original_link_id: linkId,
        link_version: linkVersion
      }
    },
    include: maintenanceInclude
  })

export const getMaintenanceItem = async (
  target: LinkTarget,
  user: WorkspaceUser,
  db: Prisma.TransactionClient = prisma,
  now = new Date()
): Promise<LinkMaintenanceItem> => {
  const row = await db.patch_resource_link.findFirst({
    where: {
      id: target.linkId,
      version: target.linkVersion,
      resource_id: target.resourceId,
      resource: {
        user_id: user.id,
        patch_id: target.patchId,
        status: 0,
        patch: { status: 0 }
      }
    },
    select: {
      ...linkHealthSelect(now),
      resource_id: true,
      resource: {
        select: {
          user_id: true,
          patch_id: true,
          name: true,
          section: true,
          patch: { select: { name: true, unique_id: true } }
        }
      }
    }
  })
  if (!row)
    throw new ResourceMutationError(E.not_found.message, E.not_found.status)
  if (row.storage === 'touchgal' && user.role < 3)
    throw new ResourceMutationError(E.forbidden.message, E.forbidden.status)
  const control = await getMaintenanceControl(db, row.id, row.version)
  const event = control?.events[0]
  const state = maintenanceState(control, now)
  const sources = await getLinkDisputeSources(
    [{ ...row, patchId: target.patchId, resourceId: target.resourceId }],
    db
  )
  const health = {
    ...projectLinkHealth(
      row,
      user.id,
      { uid: user.id, role: user.role },
      sources.get(row.id) ?? null,
      now
    ),
    maintenance: maintenanceRestriction(control, now)
  }
  // The user is the current publisher; historical/staff ownership still needs its own check.
  const linkedCase =
    event?.case_id &&
    (await (
      await import('~/app/api/case/service')
    ).canReadCaseForViewer(db, event.case_id, user.id, user.role))
      ? event.case_id
      : null
  return {
    ...target,
    eventId: event?.id ?? null,
    round: event?.round ?? null,
    maintenanceRevision: control?.revision ?? 0,
    state,
    snoozedUntil:
      state === 'snoozed'
        ? (event?.snoozed_until?.toISOString() ?? null)
        : null,
    openedAt: event?.created.toISOString() ?? null,
    respondedAt:
      event?.responded_at?.toISOString() ??
      control?.stopped_at?.toISOString() ??
      null,
    response:
      event?.outcome && event.responded_at
        ? {
            outcome: event.outcome as LinkMaintenanceOutcome,
            note: event.note,
            created: event.responded_at.toISOString()
          }
        : control?.frozen && control.stopped_at
          ? {
              outcome: 'stopped',
              note: control.stop_note,
              created: control.stopped_at.toISOString()
            }
          : null,
    reportCount: event?._count.participants ?? 0,
    caseId: linkedCase,
    patch: {
      uniqueId: row.resource.patch.unique_id,
      name: row.resource.patch.name
    },
    resource: { name: row.resource.name, section: row.resource.section },
    storage: row.storage,
    health,
    capabilities: {
      actions: maintenanceActions(
        state,
        health.capabilities.ownerActions.includes('verify')
      )
    }
  }
}

const from = Prisma.sql`
  FROM patch_resource_link l JOIN patch_resource r ON r.id=l.resource_id JOIN patch p ON p.id=r.patch_id
  LEFT JOIN patch_resource_link_maintenance m ON m.original_link_id=l.id AND m.link_version=l.version
  LEFT JOIN LATERAL (SELECT * FROM patch_resource_link_maintenance_event
    WHERE control_id=m.id ORDER BY round DESC LIMIT 1) e ON true
`
const scope = (
  user: WorkspaceUser
) => Prisma.sql`r.user_id=${user.id} AND r.status=0 AND p.status=0
  ${user.role < 3 ? Prisma.sql`AND l.storage<>'touchgal'` : Prisma.empty}`
const actionable = (
  now: Date
) => Prisma.sql`COALESCE(m.frozen,false)=false AND e.active_key IS NOT NULL
  AND (e.state='pending' OR (e.state='snoozed' AND e.snoozed_until<=${now}))`
const viewPredicate = (input: WorkspaceMaintenanceQuery) =>
  input.view === 'feedback'
    ? Prisma.sql`e.active_key IS NOT NULL AND m.frozen=false`
    : input.view === 'handled'
      ? Prisma.sql`(m.frozen=true OR (e.state='handled' AND e.active_key IS NULL))`
      : Prisma.sql`e.id IS NULL AND COALESCE(m.frozen,false)=false AND l.health<>'ok'`

export const getWorkspaceMaintenance = async (
  input: WorkspaceMaintenanceQuery,
  user: WorkspaceUser,
  db: Prisma.TransactionClient = prisma,
  now = new Date(),
  resourceId?: number
): Promise<LinkMaintenanceListResponse> => {
  const filter = Prisma.sql`${scope(user)} AND ${viewPredicate(input)}
    ${resourceId === undefined ? Prisma.empty : Prisma.sql`AND r.id=${resourceId}`}
    ${input.section !== 'all' ? Prisma.sql`AND r.section=${input.section}` : Prisma.empty}
    ${input.query ? Prisma.sql`AND (r.name ILIKE ${`%${input.query}%`} OR p.name ILIKE ${`%${input.query}%`})` : Prisma.empty}`
  const [rows, totals, counts] = await Promise.all([
    db.$queryRaw<
      LinkTarget[]
    >(Prisma.sql`SELECT l.id AS "linkId", l.version AS "linkVersion", r.id AS "resourceId", p.id AS "patchId"
      ${from} WHERE ${filter} ORDER BY e.created DESC NULLS LAST, l.id DESC
      OFFSET ${(input.page - 1) * input.limit} LIMIT ${input.limit}`),
    db.$queryRaw<{ count: bigint }[]>(
      Prisma.sql`SELECT COUNT(*) AS count ${from} WHERE ${filter}`
    ),
    db.$queryRaw<{ count: bigint }[]>(
      Prisma.sql`SELECT COUNT(*) AS count ${from} WHERE ${scope(user)} AND ${actionable(now)}`
    )
  ])
  const items = await Promise.all(
    rows.map((target) => getMaintenanceItem(target, user, db, now))
  )
  return {
    items,
    total: Number(totals[0]?.count ?? 0),
    actionableCount: Number(counts[0]?.count ?? 0),
    page: input.page,
    limit: input.limit
  }
}

export const countActionableMaintenance = async (
  uid: number,
  db: Pick<Prisma.TransactionClient, '$queryRaw'> = prisma,
  now = new Date()
) => {
  const rows = await db.$queryRaw<
    { count: bigint }[]
  >(Prisma.sql`SELECT COUNT(*) AS count ${from}
    WHERE ${scope({ id: uid, role: 1, name: '' })} AND ${actionable(now)}`)
  return Number(rows[0]?.count ?? 0)
}
export const resourceActionableMaintenanceCounts = async (
  user: WorkspaceUser,
  ids: number[],
  db: Pick<Prisma.TransactionClient, '$queryRaw'> = prisma,
  now = new Date()
) => {
  if (!ids.length) return new Map<number, number>()
  const rows = await db.$queryRaw<
    { resource_id: number; count: bigint }[]
  >(Prisma.sql`SELECT r.id AS resource_id, COUNT(*) AS count ${from}
    WHERE ${scope(user)} AND r.id IN (${Prisma.join(ids)}) AND ${actionable(now)} GROUP BY r.id`)
  return new Map(rows.map((row) => [row.resource_id, Number(row.count)]))
}

/** Selected latest present context is decoded once. Corrupt history keeps its old entry. */
export const representedPublisherLinkCaseIds = async (
  uid: number,
  db: Pick<Prisma.TransactionClient, '$queryRaw'> = prisma
) => {
  const rows = await db.$queryRaw<
    {
      id: number
      link_id: number
      link_version: number
      resource_id: number
      patch_id: number
      health: string
      evidence_round: number
      health_changed_at: Date | null
      context: Prisma.JsonValue
    }[]
  >(Prisma.sql`
    SELECT DISTINCT c.id,l.id AS link_id,l.version AS link_version,r.id AS resource_id,r.patch_id,l.health,l.evidence_round,l.health_changed_at,ctx.context
    FROM ops_case c JOIN patch_resource_link_maintenance_event e ON e.case_id=c.id
    JOIN patch_resource_link_maintenance m ON m.id=e.control_id
    JOIN patch_resource_link l ON l.id=m.link_id AND l.version=m.link_version
    JOIN patch_resource r ON r.id=l.resource_id
    JOIN patch p ON p.id=r.patch_id
    JOIN LATERAL (SELECT payload->'link_health' AS context FROM ops_case_message WHERE case_id=c.id AND kind='system' AND payload ? 'link_health'
      ORDER BY created DESC,id DESC LIMIT 1) ctx ON true
    WHERE c.owner_type='publisher' AND c.owner_id=${uid} AND c.kind='link_suspect' AND c.target_type='link'
      AND c.target_id=l.id AND r.user_id=${uid} AND m.resource_id=r.id AND m.patch_id=r.patch_id AND l.storage<>'touchgal'
      AND r.status=0 AND p.status=0
      AND c.status IN ('open','waiting_owner')
  `)
  return rows.flatMap((row) => {
    const parsed = linkCaseContextSchema.safeParse(row.context)
    if (!parsed.success) return []
    const value = parsed.data
    return value.health === 'suspect' &&
      value.source === 'user_reports' &&
      value.linkId === row.link_id &&
      value.linkVersion === row.link_version &&
      value.resourceId === row.resource_id &&
      value.patchId === row.patch_id &&
      value.health === row.health &&
      value.evidenceRound === row.evidence_round &&
      value.healthChangedAt !== null &&
      value.healthChangedAt === row.health_changed_at?.toISOString()
      ? [row.id]
      : []
  })
}
