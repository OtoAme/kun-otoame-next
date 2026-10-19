import { Prisma } from '@prisma/client'
import { CASE_UNRESOLVED_STATUSES } from '~/constants/case'
import { LINK_CASE_RESOLUTIONS } from '~/constants/linkHealth'
import { linkCaseContextSchema } from '~/validations/linkHealth'
import {
  finishLinkMaintenanceForMutation,
  lockLinkMaintenance
} from '~/app/api/patch/resource/maintenance/service'
import {
  closeCaseInternal,
  getCaseLock,
  lockCaseUsers,
  openCaseInternal,
  promoteLinkCaseInternal,
  upgradeLinkConflictContextInternal
} from './service'
import type { CaseTx } from './service'
import type {
  CloseLinkCasesInput,
  CloseLinkCasesResult,
  LinkCaseContext,
  OpenLinkCaseInput,
  OpenLinkCaseResult
} from '~/types/api/linkHealth'

const LINK_CASE_KINDS = ['link_suspect', 'link_disputed'] as const
const validId = (id: number) =>
  Number.isInteger(id) && id > 0 && id <= 2147483647
const sortedIds = (ids: readonly number[]) => {
  if (ids.some((id) => !validId(id)))
    throw new Error('Invalid link case selector')
  return [...new Set(ids)].sort((left, right) => left - right)
}
const linkCaseKey = (linkId: number, version: number) =>
  `link:${linkId}:v:${version}`

export type LinkCaseTargetRow = {
  id: number
  version: number
  resource_id: number
  patch_id: number
  storage: string
  health: string
  evidence_round: number
  health_changed_at: Date | null
  resource_user_id: number
  resource_name: string
  section: string
  resource_status: number
  patch_unique_id: string
  patch_name: string
  patch_status: number
}

/** Link-only FOR UPDATE: never acquire a resource write lock in this branch. */
export const lockLinkCaseTarget = async (tx: CaseTx, linkId: number) => {
  const rows = await tx.$queryRaw<LinkCaseTargetRow[]>(Prisma.sql`
    SELECT l.id, l.version, l.resource_id, l.storage, l.health,
           l.evidence_round, l.health_changed_at, r.patch_id,
           r.user_id AS resource_user_id, r.name AS resource_name, r.section,
           r.status AS resource_status, p.unique_id AS patch_unique_id,
           p.name AS patch_name, p.status AS patch_status
    FROM patch_resource_link l
    JOIN patch_resource r ON r.id=l.resource_id
    JOIN patch p ON p.id=r.patch_id
    WHERE l.id=${linkId}
    FOR UPDATE OF l
  `)
  return rows[0] ?? null
}

export const linkContextMatchesTarget = (
  context: LinkCaseContext,
  link: LinkCaseTargetRow
) =>
  context.linkId === link.id &&
  context.linkVersion === link.version &&
  context.resourceId === link.resource_id &&
  context.patchId === link.patch_id &&
  context.health === link.health &&
  context.evidenceRound === link.evidence_round &&
  context.healthChangedAt !== null &&
  context.healthChangedAt === (link.health_changed_at?.toISOString() ?? null)

/** Select a present context first; malformed latest data never falls back. */
export const readLinkCaseContext = async (
  tx: Pick<CaseTx, '$queryRaw'>,
  caseId: number
): Promise<LinkCaseContext | null> => {
  const rows = await tx.$queryRaw<{ context: Prisma.JsonValue }[]>(Prisma.sql`
    SELECT payload->'link_health' AS context
    FROM ops_case_message
    WHERE case_id=${caseId} AND kind='system' AND payload ? 'link_health'
    ORDER BY created DESC, id DESC
    LIMIT 1
  `)
  const decoded = linkCaseContextSchema.safeParse(rows[0]?.context)
  if (
    rows.length &&
    (!decoded.success || decoded.data.healthChangedAt === null)
  ) {
    console.warn('[LinkHealth] Invalid latest case context')
  }
  return decoded.success && decoded.data.healthChangedAt !== null
    ? decoded.data
    : null
}

/** System facts only. One unresolved key per actual link address version. */
export const openLinkCaseInternal = async (
  tx: CaseTx,
  input: OpenLinkCaseInput
): Promise<OpenLinkCaseResult> => {
  const parsed = linkCaseContextSchema.safeParse(input.context)
  if (!parsed.success) throw new Error('Invalid link case context')
  const context = parsed.data
  const reporterIds = sortedIds(input.reporterIds)
  const link = await lockLinkCaseTarget(tx, context.linkId)
  if (
    !link ||
    link.resource_status !== 0 ||
    link.patch_status !== 0 ||
    !linkContextMatchesTarget(context, link)
  ) {
    throw new Error('Link case context has changed')
  }
  const key = linkCaseKey(context.linkId, context.linkVersion)
  let sourceUpgrade = false
  const existing = await tx.ops_case.findUnique({
    where: { dedup_key: key },
    select: { id: true }
  })
  if (existing) {
    const row = await getCaseLock(tx, existing.id)
    const previous = await readLinkCaseContext(tx, existing.id)
    if (
      !row ||
      !previous ||
      row.source !== 'system' ||
      row.reporter_id !== null ||
      row.target_type !== 'link' ||
      row.target_id !== context.linkId ||
      !LINK_CASE_KINDS.includes(row.kind as never) ||
      !CASE_UNRESOLVED_STATUSES.includes(row.status as never) ||
      previous.linkId !== context.linkId ||
      previous.linkVersion !== context.linkVersion ||
      previous.resourceId !== context.resourceId ||
      previous.patchId !== context.patchId ||
      row.kind !== `link_${previous.health}` ||
      (previous.health === 'disputed' && context.health !== 'disputed')
    ) {
      throw new Error('Link case context has changed')
    }
    const promoting =
      previous.health === 'suspect' && context.health === 'disputed'
    sourceUpgrade =
      previous.source === 'owner_verification' &&
      context.source === 'machine_user_conflict'
    if (
      promoting
        ? context.evidenceRound !== previous.evidenceRound + 1
        : context.evidenceRound !== previous.evidenceRound ||
          context.healthChangedAt !== previous.healthChangedAt
    ) {
      throw new Error('Link case context has changed')
    }
  }
  const opened = await openCaseInternal(tx, {
    kind: context.health === 'suspect' ? 'link_suspect' : 'link_disputed',
    targetType: 'link',
    targetId: context.linkId,
    reporterId: null,
    source: 'system',
    allowFrozen: true,
    linkContext: context,
    now: input.now
  })
  if (typeof opened === 'string' || 'justClosed' in opened)
    throw new Error('Link case context has changed')
  const accounts = await lockCaseUsers(tx, reporterIds)
  const subscribers = reporterIds.filter((id) => accounts.has(id))
  if (subscribers.length)
    await tx.ops_case_subscriber.createMany({
      data: subscribers.map((user_id) => ({ case_id: opened.caseId, user_id })),
      skipDuplicates: true
    })
  if (opened.created)
    return { caseId: opened.caseId, created: true, changed: true }
  const row = await getCaseLock(tx, opened.caseId)
  if (!row) throw new Error('Link case context has changed')
  if (row.kind === 'link_suspect' && context.health === 'disputed') {
    const changed = await promoteLinkCaseInternal(
      tx,
      row.id,
      context,
      input.now
    )
    if (!changed) throw new Error('Link case context has changed')
    return { caseId: row.id, created: false, changed: true }
  }
  if (sourceUpgrade) {
    const changed = await upgradeLinkConflictContextInternal(
      tx,
      row.id,
      context,
      input.now
    )
    if (!changed) throw new Error('Link case context has changed')
    return { caseId: row.id, created: false, changed: true }
  }
  return { caseId: row.id, created: false, changed: false }
}

/** Link locks precede every case lock; resource locks belong to the caller. */
export const closeLinkCases = async (
  tx: CaseTx,
  input: CloseLinkCasesInput & {
    excludeRecipientIds?: readonly number[]
    suppressPublisher?: boolean
    notificationBatch?: Set<number>
  }
): Promise<CloseLinkCasesResult> => {
  const selectors = ['resourceIds', 'linkIds', 'targets'] as const
  const chosen = selectors.filter((key) => input[key] !== undefined)
  if (
    chosen.length !== 1 ||
    !Object.hasOwn(LINK_CASE_RESOLUTIONS, input.resolution)
  ) {
    throw new Error('Invalid link case selector or resolution')
  }
  const ids = sortedIds(
    input.resourceIds ??
      input.linkIds ??
      input.targets!.map((target) => target.linkId)
  )
  if (!ids.length) return { closedCaseIds: [] }
  if (input.targets?.some((target) => !validId(target.linkVersion))) {
    throw new Error('Invalid link case version')
  }
  const where = input.resourceIds
    ? Prisma.sql`l.resource_id IN (${Prisma.join(ids)})`
    : Prisma.sql`l.id IN (${Prisma.join(ids)})`
  const links = await tx.$queryRaw<
    {
      id: number
      version: number
      resource_id: number
      patch_id: number
      patch_unique_id: string
    }[]
  >(Prisma.sql`
    SELECT l.id, l.version, l.resource_id, r.patch_id, p.unique_id AS patch_unique_id
    FROM patch_resource_link l JOIN patch_resource r ON r.id=l.resource_id
    JOIN patch p ON p.id=r.patch_id
    WHERE ${where}
    ORDER BY l.id ASC
    FOR UPDATE OF l
  `)
  const targets = input.targets
    ? input.targets.filter((target) =>
        links.some((link) => link.id === target.linkId)
      )
    : links.map((link) => ({ linkId: link.id, linkVersion: link.version }))
  if (!targets.length) return { closedCaseIds: [] }
  const notified = input.notificationBatch ?? new Set<number>()
  for (const id of input.excludeRecipientIds ?? []) notified.add(id)
  if (input.resolution === 'link_removed' || input.resolution === 'relinked') {
    await lockLinkMaintenance(
      tx,
      links.map((link) => link.id)
    )
    for (const resourceId of [
      ...new Set(links.map((link) => link.resource_id))
    ]) {
      const group = links.filter((link) => link.resource_id === resourceId)
      const results = await finishLinkMaintenanceForMutation(tx, {
        links: targets
          .filter((target) => group.some((link) => link.id === target.linkId))
          .map((target) => ({
            id: target.linkId,
            version: target.linkVersion
          })),
        resourceId,
        uniqueId: group[0].patch_unique_id,
        outcome: input.resolution === 'relinked' ? 'relinked' : 'removed',
        actorId: input.actorId ?? 0,
        now: input.now,
        excludeRecipientIds: [...notified]
      })
      for (const id of results) notified.add(id)
    }
  }
  const keys = [
    ...new Set(
      targets.map((target) => linkCaseKey(target.linkId, target.linkVersion))
    )
  ]
  const cases = await tx.$queryRaw<
    { id: number; target_id: number; kind: string; dedup_key: string }[]
  >(Prisma.sql`
    SELECT id, target_id, kind, dedup_key
    FROM ops_case
    WHERE target_type='link' AND kind IN (${Prisma.join([...LINK_CASE_KINDS])})
      AND source='system' AND reporter_id IS NULL
      AND status IN (${Prisma.join([...CASE_UNRESOLVED_STATUSES])})
      AND dedup_key IN (${Prisma.join(keys)})
    ORDER BY id ASC
    FOR UPDATE
  `)
  const closedCaseIds: number[] = []
  for (const row of cases) {
    const context = await readLinkCaseContext(tx, row.id)
    const link = links.find((item) => item.id === row.target_id)
    if (
      !context ||
      !link ||
      context.linkId !== link.id ||
      context.resourceId !== link.resource_id ||
      context.patchId !== link.patch_id ||
      linkCaseKey(context.linkId, context.linkVersion) !== row.dedup_key ||
      !keys.includes(row.dedup_key) ||
      row.kind !== `link_${context.health}`
    )
      continue
    const result = await closeCaseInternal(tx, {
      caseId: row.id,
      expectedStatuses: [...CASE_UNRESOLVED_STATUSES],
      resolution: input.resolution,
      actorType: input.actorType,
      actorId: input.actorId,
      payload: { link_health: context },
      excludeRecipientIds: [...notified],
      suppressLinkPublisher:
        input.suppressPublisher ?? input.actorType === 'system',
      now: input.now
    })
    if (result.changed) closedCaseIds.push(row.id)
  }
  return { closedCaseIds }
}
