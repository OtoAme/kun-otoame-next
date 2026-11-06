import { Prisma } from '@prisma/client'
import { lockLinkMaintenance } from '~/app/api/patch/resource/maintenance/service'
import { updatePatchAttributes } from '~/app/api/patch/resource/_helper'
import {
  ResourceMutationError,
  runResourceMutation
} from '~/app/api/patch/resource/mutation'
import { RESOURCE_STATUS_MAP } from '~/constants/admin'
import { prisma } from '~/prisma/index'
import { OFFICIAL_MIRROR_SECTIONS } from '~/types/api/officialMirror'
import type {
  MergeBatchResult,
  MergeDismissCardResult,
  MergeFieldComparison,
  MergeHistoryEntry,
  MergeListItem,
  MergeListResponse,
  MergeOption,
  MergeOptionsResponse,
  MergePreview,
  MergeResult,
  MergeSort,
  MergeTab,
  OfficialMirrorLinkView,
  OfficialMirrorPublisher,
  OfficialMirrorSection
} from '~/types/api/officialMirror'
import type { z } from 'zod'
import type {
  mergeBatchSchema,
  mergeDismissCardSchema,
  mergeExecuteSchema,
  mergeListSchema,
  mergeOptionsSchema,
  mergePairSchema
} from '~/validations/officialMirror'
import { refreshAfterCommit } from './cache'
import {
  BLOCK_MESSAGE,
  CLOSED_CASE_STATUSES,
  OPEN_CASE_STATUSES,
  asSection,
  assessMergeOptions,
  buildCandidates,
  compareLinkDisplayOrder,
  factPairBlocks,
  isStaffCandidateCard,
  isUserCandidateCard,
  linkChangedAt,
  mergeBasis,
  mergeFacts,
  mergeNotes,
  movedLinkSorts,
  pairBlocks,
  pairWaitSince,
  planGrants,
  toMergeDetail,
  type GrantRow,
  type MergeDetail,
  type MergeFacts,
  type MergeOptionFact,
  type MergeRecordFact,
  type MirrorCard,
  type MirrorLink,
  type OpenCaseFact
} from './decide'
import { OfficialMirrorError } from './errors'
import {
  asDate,
  asNumber,
  asText,
  recordsOf,
  rowCard,
  rowLink,
  rowMergeRecord
} from './rows'
import { sqlTimestamp } from './time'

type ExecuteInput = z.infer<typeof mergeExecuteSchema>
type Db = Prisma.TransactionClient | typeof prisma

const sectionOf = (value: string): OfficialMirrorSection =>
  value === 'patch' ? 'patch' : 'galgame'

const cardColumns = Prisma.sql`
  r.id, r.name, r.section, r.patch_id, r.download, r.user_id, r.status, r.note,
  r.type, r.language, r.platform, r.publisher_left_at, r.created, r.updated,
  u.name AS publisher_name, u.role AS role,
  p.name AS patch_name, p.unique_id AS patch_unique_id, p.status AS patch_status
`

const recordColumns = Prisma.sql`
  user_resource_id, staff_resource_id, patch_id, section, status, detail,
  handled_at, handled_by_user_id
`

const secretLinkColumns = Prisma.sql`
  l.id, l.resource_id, l.storage, l.content, l.size, l.code, l.password, l.hash,
  l.version, l.sort_order, l.attached_at, l.content_changed_at
`

const publicLink = (link: MirrorLink): OfficialMirrorLinkView => {
  const changedAt = linkChangedAt(link)
  return {
    id: link.id,
    storage: link.storage,
    content: link.content,
    size: link.size,
    version: link.version,
    sortOrder: link.sortOrder,
    changedAt: changedAt ? changedAt.toISOString() : null,
    backedUpAt:
      link.storage === 'touchgal' && changedAt ? changedAt.toISOString() : null
  }
}

const summaryOf = (card: MirrorCard) => ({
  id: card.id,
  name: card.name,
  section: sectionOf(card.section),
  patchId: card.patchId,
  patchUniqueId: card.patchUniqueId,
  patchName: card.patchName,
  publisher: { id: card.userId, name: card.publisherName },
  download: card.download,
  created: card.created.toISOString(),
  status: card.status
})

/** Reads a stored merged detail. Old details without `recommended` still parse. */
export const parseMergeDetail = (value: unknown): MergeDetail | null => {
  const source =
    typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value) as unknown
          } catch {
            return null
          }
        })()
      : value
  if (!source || typeof source !== 'object') return null
  const row = source as Record<string, unknown>
  const movedLinkIds = Array.isArray(row.movedLinkIds)
    ? row.movedLinkIds.filter((id): id is number => typeof id === 'number')
    : null
  if (!movedLinkIds || typeof row.noteAppended !== 'boolean') return null
  const sourceAuthorId = asNumber(row.sourceAuthorId)
  const likeCount = asNumber(row.likeCount)
  const userResourceId = asNumber(row.userResourceId)
  const staffResourceId = asNumber(row.staffResourceId)
  if (
    sourceAuthorId === null ||
    likeCount === null ||
    userResourceId === null ||
    staffResourceId === null ||
    typeof row.basis !== 'string'
  ) {
    return null
  }
  return toMergeDetail({
    movedLinkIds,
    noteAppended: row.noteAppended,
    contentConfirmed: true,
    basis: row.basis,
    sourceAuthorId,
    likeCount,
    userResourceId,
    staffResourceId,
    // Older records omit the key; a non-boolean value is ignored.
    recommended:
      typeof row.recommended === 'boolean' ? row.recommended : undefined
  })
}

const loadCards = async (db: Db, ids: number[], lock: boolean) => {
  if (!ids.length) return [] as MirrorCard[]
  if (lock) {
    await db.$queryRaw(Prisma.sql`
      /* om:lock-resources */
      SELECT id FROM patch_resource
      WHERE id IN (${Prisma.join(ids)})
      ORDER BY id ASC
      FOR UPDATE
    `)
  }
  const rows = recordsOf(
    await db.$queryRaw(Prisma.sql`
      SELECT ${cardColumns}
      FROM patch_resource r
      JOIN "user" u ON u.id = r.user_id
      JOIN patch p ON p.id = r.patch_id
      WHERE r.id IN (${Prisma.join(ids)})
    `)
  )
  return rows.flatMap((row) => {
    const card = rowCard(row, [])
    return card ? [card] : []
  })
}

const loadLinks = async (db: Db, resourceIds: number[], lock: boolean) => {
  if (!resourceIds.length) return [] as MirrorLink[]
  const rows = recordsOf(
    await db.$queryRaw(
      lock
        ? Prisma.sql`
            /* om:lock-links */
            SELECT ${secretLinkColumns}
            FROM patch_resource_link l
            WHERE l.resource_id IN (${Prisma.join(resourceIds)})
            ORDER BY l.id ASC
            FOR UPDATE
          `
        : Prisma.sql`
            SELECT ${secretLinkColumns}
            FROM patch_resource_link l
            WHERE l.resource_id IN (${Prisma.join(resourceIds)})
            ORDER BY l.id ASC
          `
    )
  )
  return rows.flatMap((row) => {
    const link = rowLink(row)
    return link ? [link] : []
  })
}

const withLinks = (cards: MirrorCard[], links: MirrorLink[]) =>
  cards.map((card) => ({
    ...card,
    links: links
      .filter((link) => link.resourceId === card.id)
      .sort(compareLinkDisplayOrder)
  }))

const readPairRecord = async (
  db: Db,
  userResourceId: number,
  staffResourceId: number,
  lock: boolean
) => {
  const rows = recordsOf(
    await db.$queryRaw(
      lock
        ? Prisma.sql`
            /* om:lock-merge-record */
            SELECT ${recordColumns}
            FROM patch_resource_merge_record
            WHERE user_resource_id = ${userResourceId}
              AND staff_resource_id = ${staffResourceId}
            FOR UPDATE
          `
        : Prisma.sql`
            SELECT ${recordColumns}
            FROM patch_resource_merge_record
            WHERE user_resource_id = ${userResourceId}
              AND staff_resource_id = ${staffResourceId}
          `
    )
  )
  const row = rows[0]
  if (!row) return null
  const record = rowMergeRecord({
    ...row,
    user_resource_id: userResourceId,
    staff_resource_id: staffResourceId
  })
  return record
}

const replayResult = async (
  db: Db,
  record: MergeRecordFact
): Promise<Omit<MergeResult, 'cacheRefreshed'>> => {
  const detail = parseMergeDetail(record.detail)
  if (!detail) throw new OfficialMirrorError('合并记录无法读取')
  const rows = recordsOf(
    await db.$queryRaw(Prisma.sql`
      SELECT r.id, r.section, r.patch_id, p.unique_id
      FROM patch_resource r
      JOIN patch p ON p.id = r.patch_id
      WHERE r.id = ${record.userResourceId}
    `)
  )
  const live = rows[0]
  const patchId = asNumber(live?.patch_id) ?? record.patchId
  const section =
    asSection(asText(live?.section)) ?? asSection(record.section) ?? 'galgame'
  let patchUniqueId = asText(live?.unique_id)
  if (!patchUniqueId) {
    const patches = recordsOf(
      await db.$queryRaw(Prisma.sql`
        SELECT unique_id FROM patch WHERE id = ${patchId}
      `)
    )
    patchUniqueId = asText(patches[0]?.unique_id)
  }
  return {
    alreadyMerged: true,
    userResourceId: record.userResourceId,
    staffResourceId: record.staffResourceId,
    resourceId: record.userResourceId,
    patchId,
    patchUniqueId,
    section,
    movedLinkIds: detail.movedLinkIds,
    noteAppended: detail.noteAppended
  }
}

const loadCases = async (
  tx: Prisma.TransactionClient,
  resourceIds: number[],
  linkIds: number[]
) => {
  const resourceClause = Prisma.sql`(target_type = 'resource' AND target_id IN (${Prisma.join(resourceIds)}))`
  const linkClause = linkIds.length
    ? Prisma.sql`OR (target_type = 'link' AND target_id IN (${Prisma.join(linkIds)}))`
    : Prisma.empty
  const rows = recordsOf(
    await tx.$queryRaw(Prisma.sql`
      /* om:lock-cases */
      SELECT id, target_type, target_id, status, revision
      FROM ops_case
      WHERE (status IN ('open', 'waiting_reporter', 'waiting_owner', 'resolved', 'rejected'))
        AND (${resourceClause} ${linkClause})
      ORDER BY id ASC
      FOR UPDATE
    `)
  )
  return rows.flatMap((row) => {
    const id = asNumber(row.id)
    const targetId = asNumber(row.target_id)
    const revision = asNumber(row.revision)
    if (id === null || targetId === null || revision === null) return []
    return [
      {
        id,
        targetType: asText(row.target_type),
        targetId,
        status: asText(row.status),
        revision
      } satisfies OpenCaseFact
    ]
  })
}

const loadGrants = async (
  tx: Prisma.TransactionClient,
  resourceIds: number[]
) => {
  const rows = recordsOf(
    await tx.$queryRaw(Prisma.sql`
      /* om:lock-grants */
      SELECT actor_key, resource_id, expires
      FROM patch_resource_access_grant
      WHERE resource_id IN (${Prisma.join(resourceIds)})
      ORDER BY actor_key ASC, resource_id ASC
      FOR UPDATE
    `)
  )
  return rows.flatMap((row) => {
    const resourceId = asNumber(row.resource_id)
    const expires = asDate(row.expires)
    const actorKey = asText(row.actor_key)
    if (resourceId === null || !expires || !actorKey) return []
    return [{ actorKey, resourceId, expires } satisfies GrantRow]
  })
}

const relatedRecordsFrom = async (db: Db, query: Prisma.Sql) => {
  const rows = recordsOf(await db.$queryRaw(query))
  return rows.flatMap((row) => {
    const record = rowMergeRecord(row)
    return record ? [record] : []
  })
}

const relatedRecords = async (db: Db, ids: number[]) => {
  if (!ids.length) return [] as MergeRecordFact[]
  return relatedRecordsFrom(
    db,
    Prisma.sql`
    SELECT ${recordColumns}
    FROM patch_resource_merge_record
    WHERE user_resource_id IN (${Prisma.join(ids)})
       OR staff_resource_id IN (${Prisma.join(ids)})
  `
  )
}

const gameCards = async (db: Db, patchId: number, section: string) => {
  const rows = recordsOf(
    await db.$queryRaw(Prisma.sql`
      SELECT ${cardColumns}
      FROM patch_resource r
      JOIN "user" u ON u.id = r.user_id
      JOIN patch p ON p.id = r.patch_id
      WHERE r.patch_id = ${patchId} AND r.section = ${section}
    `)
  )
  const cards = rows.flatMap((row) => {
    const card = rowCard(row, [])
    return card ? [card] : []
  })
  const links = await loadLinks(
    db,
    cards.map((card) => card.id),
    false
  )
  return withLinks(cards, links)
}

/** Every card of one game in both sections. Merge keeps using `gameCards`. */
const patchCards = async (db: Db, patchId: number) => {
  const rows = recordsOf(
    await db.$queryRaw(Prisma.sql`
      /* om:patch-cards */
      SELECT ${cardColumns}
      FROM patch_resource r
      JOIN "user" u ON u.id = r.user_id
      JOIN patch p ON p.id = r.patch_id
      WHERE r.patch_id = ${patchId}
        AND r.section IN (${Prisma.join([...OFFICIAL_MIRROR_SECTIONS])})
    `)
  )
  const cards = cardsFrom(rows)
  const links = await loadLinks(
    db,
    cards.map((card) => card.id),
    false
  )
  return withLinks(cards, links)
}

/** Open case ids per card, resource and link targets. Plain read, no locks. */
const openCasesByResource = async (db: Db, resourceIds: number[]) => {
  const result = new Map<number, number[]>()
  if (!resourceIds.length) return result
  const statuses = Prisma.join([...OPEN_CASE_STATUSES])
  const ids = Prisma.join(resourceIds)
  const rows = recordsOf(
    await db.$queryRaw(Prisma.sql`
      /* om:open-cases */
      SELECT c.id AS case_id, c.target_id AS resource_id
      FROM ops_case c
      WHERE c.status IN (${statuses})
        AND c.target_type = 'resource'
        AND c.target_id IN (${ids})
      UNION
      SELECT c.id AS case_id, l.resource_id AS resource_id
      FROM ops_case c
      JOIN patch_resource_link l ON l.id = c.target_id
      WHERE c.status IN (${statuses})
        AND c.target_type = 'link'
        AND l.resource_id IN (${ids})
      ORDER BY case_id ASC
    `)
  )
  for (const row of rows) {
    const caseId = asNumber(row.case_id)
    const resourceId = asNumber(row.resource_id)
    if (caseId === null || resourceId === null) continue
    const list = result.get(resourceId) ?? []
    if (!list.includes(caseId)) list.push(caseId)
    result.set(resourceId, list)
  }
  return result
}

/** Staff cards (role >= 3) per game, both sections, excluding nothing. */
const officialCounts = async (patchIds: number[]) => {
  const result = new Map<number, number>()
  if (!patchIds.length) return result
  const rows = recordsOf(
    await prisma.$queryRaw(Prisma.sql`
      /* om:official-count */
      SELECT r.patch_id, COUNT(*)::int AS total
      FROM patch_resource r
      JOIN "user" u ON u.id = r.user_id
      WHERE r.patch_id IN (${Prisma.join(patchIds)})
        AND u.role >= 3
        AND r.section IN (${Prisma.join([...OFFICIAL_MIRROR_SECTIONS])})
      GROUP BY r.patch_id
    `)
  )
  for (const row of rows) {
    const patchId = asNumber(row.patch_id)
    const total = asNumber(row.total)
    if (patchId !== null && total !== null) result.set(patchId, total)
  }
  return result
}

const userNames = async (db: Db, ids: number[]) => {
  const result = new Map<number, OfficialMirrorPublisher>()
  const unique = [...new Set(ids)]
  if (!unique.length) return result
  const rows = recordsOf(
    await db.$queryRaw(Prisma.sql`
      /* om:handlers */
      SELECT id, name FROM "user" WHERE id IN (${Prisma.join(unique)})
    `)
  )
  for (const row of rows) {
    const id = asNumber(row.id)
    if (id !== null) result.set(id, { id, name: asText(row.name) })
  }
  return result
}

const hasStaffBackup = (card: Pick<MirrorCard, 'links'>) =>
  card.links.some((link) => link.storage === 'touchgal')

const actorName = async (tx: Prisma.TransactionClient, actorId: number) => {
  const actor = await tx.user.findUnique({
    where: { id: actorId },
    select: { name: true }
  })
  if (!actor) throw new OfficialMirrorError('未找到该管理员')
  return actor.name
}

const applyGrants = async (
  tx: Prisma.TransactionClient,
  userResourceId: number,
  staffResourceId: number,
  grants: GrantRow[]
) => {
  for (const action of planGrants(userResourceId, staffResourceId, grants)) {
    if (action.kind === 'move') {
      await tx.patch_resource_access_grant.update({
        where: {
          actor_key_resource_id: {
            actor_key: action.actorKey,
            resource_id: staffResourceId
          }
        },
        data: { resource_id: userResourceId }
      })
      continue
    }
    await tx.patch_resource_access_grant.update({
      where: {
        actor_key_resource_id: {
          actor_key: action.actorKey,
          resource_id: userResourceId
        }
      },
      data: { expires: action.expires }
    })
    await tx.patch_resource_access_grant.delete({
      where: {
        actor_key_resource_id: {
          actor_key: action.actorKey,
          resource_id: staffResourceId
        }
      }
    })
  }
}

const writeMerge = async (
  tx: Prisma.TransactionClient,
  input: {
    user: MirrorCard
    staff: MirrorCard
    actorId: number
    basis: string
    openCases: OpenCaseFact[]
    grants: GrantRow[]
    recommended: boolean
  }
) => {
  const notes = mergeNotes(input.user.note, input.staff.note)
  const moves = movedLinkSorts(input.user, input.staff)
  for (const move of moves) {
    await tx.patch_resource_link.update({
      where: { id: move.id },
      data: { resource_id: input.user.id, sort_order: move.sortOrder }
    })
  }
  for (const link of input.staff.links) {
    await tx.patch_resource_link_history.create({
      data: {
        resource_id: input.user.id,
        link_id: link.id,
        from_version: link.version,
        old_content: link.content,
        old_storage: link.storage,
        old_size: link.size,
        reason: 'merge',
        operator_user_id: input.actorId
      }
    })
  }
  await tx.patch_resource_link_history.updateMany({
    where: { resource_id: input.staff.id },
    data: { resource_id: input.user.id }
  })
  await tx.patch_resource_access.updateMany({
    where: { resource_id: input.staff.id },
    data: { resource_id: input.user.id }
  })
  await applyGrants(tx, input.user.id, input.staff.id, input.grants)
  await tx.patch_resource_link_check.updateMany({
    where: { resource_id: input.staff.id },
    data: { resource_id: input.user.id }
  })
  await tx.patch_resource_link_maintenance.updateMany({
    where: { resource_id: input.staff.id },
    data: { resource_id: input.user.id }
  })
  await tx.help_post.updateMany({
    where: { resource_id: input.staff.id },
    data: { resource_id: input.user.id }
  })
  const closedIds = input.openCases
    .filter(
      (item) =>
        item.targetType === 'resource' &&
        item.targetId === input.staff.id &&
        CLOSED_CASE_STATUSES.includes(
          item.status as (typeof CLOSED_CASE_STATUSES)[number]
        )
    )
    .map((item) => item.id)
  if (closedIds.length) {
    await tx.ops_case.updateMany({
      where: {
        id: { in: closedIds },
        target_type: 'resource',
        target_id: input.staff.id,
        status: { in: [...CLOSED_CASE_STATUSES] }
      },
      data: { target_id: input.user.id }
    })
  }
  const likeCount = await tx.user_patch_resource_like_relation.count({
    where: { resource_id: input.staff.id }
  })
  await tx.patch_resource.update({
    where: { id: input.user.id },
    data: {
      note: notes.note,
      download: { increment: input.staff.download }
    }
  })
  await tx.patch_resource.delete({ where: { id: input.staff.id } })
  const patchUniqueId = await updatePatchAttributes(input.user.patchId, tx)
  const detail = toMergeDetail({
    movedLinkIds: moves.map((move) => move.id),
    noteAppended: notes.appended,
    contentConfirmed: true,
    basis: input.basis,
    sourceAuthorId: input.staff.userId,
    likeCount,
    userResourceId: input.user.id,
    staffResourceId: input.staff.id,
    recommended: input.recommended
  })
  const inserted = recordsOf(
    await tx.$queryRaw(Prisma.sql`
      INSERT INTO patch_resource_merge_record (
        user_resource_id, staff_resource_id, patch_id, section, status,
        handled_at, handled_by_user_id, detail
      )
      VALUES (
        ${input.user.id}, ${input.staff.id}, ${input.user.patchId}, ${input.user.section},
        'merged', ${sqlTimestamp(new Date())}, ${input.actorId}, ${JSON.stringify(detail)}::jsonb
      )
      ON CONFLICT (user_resource_id, staff_resource_id) DO NOTHING
      RETURNING id
    `)
  )
  if (!inserted.length) throw new OfficialMirrorError('合并冲突，请重试')
  const name = await actorName(tx, input.actorId)
  await tx.admin_log.create({
    data: {
      type: 'resource_merge',
      user_id: input.actorId,
      content: `管理员 ${name} 合并了资源 ${detail.userResourceId} 与站方资源 ${detail.staffResourceId}。移动链接 ${detail.movedLinkIds.join('、') || '无'}。备注追加站方备份说明：${detail.noteAppended ? '是' : '否'}。来源作者 ${detail.sourceAuthorId}。舍弃点赞 ${detail.likeCount}。`
    }
  })
  return {
    alreadyMerged: false,
    userResourceId: input.user.id,
    staffResourceId: input.staff.id,
    resourceId: input.user.id,
    patchId: input.user.patchId,
    patchUniqueId,
    section: sectionOf(input.user.section),
    movedLinkIds: detail.movedLinkIds,
    noteAppended: detail.noteAppended,
    authorIds: [input.user.userId, input.staff.userId]
  }
}

const mergeLocked = async (
  input: ExecuteInput,
  actorId: number,
  requireHighConfidence: boolean
) => {
  if (input.contentConfirmed !== true) {
    throw new OfficialMirrorError(BLOCK_MESSAGE.content_unconfirmed)
  }
  return runResourceMutation(async (tx) => {
    const ordered = [input.userResourceId, input.staffResourceId].sort(
      (left, right) => left - right
    )
    const locked = await loadCards(tx, ordered, true)
    const record = await readPairRecord(
      tx,
      input.userResourceId,
      input.staffResourceId,
      true
    )
    if (record?.status === 'merged') return replayResult(tx, record)
    const user = locked.find((card) => card.id === input.userResourceId)
    const staff = locked.find((card) => card.id === input.staffResourceId)
    if (!user || !staff)
      throw new OfficialMirrorError(BLOCK_MESSAGE.resource_missing)
    const links = await loadLinks(tx, [user.id, staff.id], true)
    const [userCard, staffCard] = withLinks([user, staff], links)
    await lockLinkMaintenance(
      tx,
      links.map((link) => link.id)
    )
    const cases = await loadCases(
      tx,
      [user.id, staff.id],
      links.map((link) => link.id)
    )
    const grants = await loadGrants(tx, [user.id, staff.id])
    const records = await relatedRecords(tx, [user.id, staff.id])
    const staffOpen = cases.filter(
      (item) =>
        OPEN_CASE_STATUSES.includes(
          item.status as (typeof OPEN_CASE_STATUSES)[number]
        ) &&
        ((item.targetType === 'resource' && item.targetId === staff.id) ||
          (item.targetType === 'link' &&
            staffCard.links.some((link) => link.id === item.targetId)))
    )
    const blocks = pairBlocks({
      user: userCard,
      staff: staffCard,
      openCaseIds: staffOpen.map((item) => item.id),
      record,
      userMergedElsewhere: records.some(
        (item) =>
          item.status === 'merged' &&
          item.userResourceId === user.id &&
          item.staffResourceId !== staff.id
      ),
      staffIsSurvivor: records.some(
        (item) => item.status === 'merged' && item.userResourceId === staff.id
      ),
      userIsSurvivor: records.some(
        (item) => item.status === 'merged' && item.userResourceId === user.id
      )
    })
    if (blocks.length) throw new OfficialMirrorError(blocks[0].message)
    const basis = mergeBasis({
      user: userCard,
      staff: staffCard,
      openCases: staffOpen
    })
    if (basis !== input.basis)
      throw new OfficialMirrorError(BLOCK_MESSAGE.basis_stale)
    const others = await gameCards(tx, user.patchId, user.section)
    const overlaid = [
      ...others.filter((card) => card.id !== user.id && card.id !== staff.id),
      userCard,
      staffCard
    ]
    const classRecords = await relatedRecords(
      tx,
      overlaid.map((card) => card.id)
    )
    const facts = mergeFacts(overlaid, classRecords)
    if (requireHighConfidence) {
      const pair = facts.candidates.find(
        (item) => item.user.id === user.id && item.staff.id === staff.id
      )
      if (pair?.pairClass !== 'high') {
        throw new OfficialMirrorError(BLOCK_MESSAGE.not_high_confidence)
      }
    }
    const recommended = await recommendedAtMerge(tx, {
      user: userCard,
      staff: staffCard,
      cards: overlaid,
      facts,
      staffOpenCaseIds: staffOpen.map((item) => item.id)
    })
    return writeMerge(tx, {
      user: userCard,
      staff: staffCard,
      actorId,
      basis,
      openCases: cases,
      grants,
      recommended
    })
  })
}

/**
 * Statistics for the merge record. Reads the other staff cards' open cases
 * without locks and never rejects the merge.
 */
const recommendedAtMerge = async (
  tx: Prisma.TransactionClient,
  input: {
    user: MirrorCard
    staff: MirrorCard
    cards: MirrorCard[]
    facts: MergeFacts
    staffOpenCaseIds: number[]
  }
) => {
  const staffCards = input.cards.filter(
    (card) => card.id !== input.user.id && isStaffCandidateCard(card)
  )
  const otherOpen = await openCasesByResource(
    tx,
    staffCards
      .filter((card) => card.id !== input.staff.id)
      .map((card) => card.id)
  )
  const assessment = assessMergeOptions({
    user: input.user,
    staffCards,
    facts: input.facts,
    openCaseIds: (staffId) =>
      staffId === input.staff.id
        ? input.staffOpenCaseIds
        : (otherOpen.get(staffId) ?? [])
  })
  return assessment.recommendedStaffId === input.staff.id
}

const settle = async (
  result: Awaited<ReturnType<typeof mergeLocked>>
): Promise<MergeResult> => {
  const authorIds = 'authorIds' in result ? result.authorIds : []
  const cacheRefreshed = await refreshAfterCommit('resource-merge', {
    uniqueIds: result.patchUniqueId ? [result.patchUniqueId] : [],
    authorIds
  })
  return {
    alreadyMerged: result.alreadyMerged,
    userResourceId: result.userResourceId,
    staffResourceId: result.staffResourceId,
    resourceId: result.resourceId,
    patchId: result.patchId,
    patchUniqueId: result.patchUniqueId,
    section: result.section,
    movedLinkIds: result.movedLinkIds,
    noteAppended: result.noteAppended,
    cacheRefreshed
  }
}

export const mergeStaffIntoUser = async (
  input: ExecuteInput,
  actorId: number,
  requireHighConfidence = false
): Promise<MergeResult | string> => {
  try {
    return await settle(
      await mergeLocked(input, actorId, requireHighConfidence)
    )
  } catch (error) {
    if (error instanceof OfficialMirrorError) return error.message
    throw error
  }
}

const errorCode = (error: unknown) => {
  if (!error || typeof error !== 'object') return ''
  const record = error as { code?: unknown; meta?: { code?: unknown } }
  if (typeof record.code === 'string') return record.code
  if (typeof record.meta?.code === 'string') return record.meta.code
  return ''
}

/** Connection loss stops the batch. A bad pair does not. */
const batchStops = (error: unknown) => {
  const code = errorCode(error)
  if (['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(code)) return true
  if (
    error instanceof Error &&
    (error.name === 'PrismaClientInitializationError' ||
      error.name === 'PrismaClientRustPanicError')
  ) {
    return true
  }
  const message = error instanceof Error ? error.message : ''
  return /ECONNREFUSED|ECONNRESET|ETIMEDOUT|connection reset|Connection terminated|Can't reach database server|Server has closed the connection|timeout exceeded when trying to connect/i.test(
    message
  )
}

const pairFailureReason = (error: unknown) => {
  if (batchStops(error)) return '合并事务中断'
  if (error instanceof ResourceMutationError) return '合并冲突重试已用尽'
  const code = errorCode(error)
  if (code === 'P2002' || code === '23505') return '合并约束冲突'
  if (code === 'P2034' || code === '40001' || code === '40P01') {
    return '合并冲突重试已用尽'
  }
  return '这一对合并失败'
}

const logPairFailure = (
  ref: { userResourceId: number; staffResourceId: number },
  reason: string,
  error: unknown
) => {
  console.error('[official-mirror] merge pair failed', {
    userResourceId: ref.userResourceId,
    staffResourceId: ref.staffResourceId,
    reason,
    code: errorCode(error)
  })
}

export const mergeStaffBatch = async (
  input: z.infer<typeof mergeBatchSchema>,
  actorId: number
): Promise<MergeBatchResult> => {
  const outcomes: MergeBatchResult['outcomes'] = []
  for (let index = 0; index < input.pairs.length; index += 1) {
    const pair = input.pairs[index]
    const ref = {
      userResourceId: pair.userResourceId,
      staffResourceId: pair.staffResourceId
    }
    try {
      const result = await mergeStaffIntoUser(pair, actorId, true)
      outcomes.push(
        typeof result === 'string'
          ? { ...ref, status: 'skipped', reason: result }
          : { ...ref, status: 'merged', result }
      )
    } catch (error) {
      const reason = pairFailureReason(error)
      logPairFailure(ref, reason, error)
      outcomes.push({ ...ref, status: 'failed', reason })
      if (!batchStops(error)) continue
      return {
        outcomes,
        remaining: input.pairs.slice(index + 1).map((item) => ({
          userResourceId: item.userResourceId,
          staffResourceId: item.staffResourceId
        }))
      }
    }
  }
  return { outcomes, remaining: [] }
}

const fieldText = (value: unknown) =>
  Array.isArray(value) ? [...value].sort().join('、') : String(value ?? '')

const comparison = (
  user: MirrorCard,
  staff: MirrorCard
): MergeFieldComparison[] =>
  [
    ['名称', user.name, staff.name],
    ['类型', fieldText(user.type), fieldText(staff.type)],
    ['语言', fieldText(user.language), fieldText(staff.language)],
    ['平台', fieldText(user.platform), fieldText(staff.platform)],
    ['备注', user.note, staff.note],
    [
      '状态',
      RESOURCE_STATUS_MAP[user.status] ?? String(user.status),
      RESOURCE_STATUS_MAP[staff.status] ?? String(staff.status)
    ],
    ['创建时间', user.created.toISOString(), staff.created.toISOString()],
    ['链接数', String(user.links.length), String(staff.links.length)]
  ].map(([field, userValue, staffValue]) => ({
    field,
    user: userValue,
    staff: staffValue
  }))

export const previewResourceMerge = async (
  input: z.infer<typeof mergePairSchema>
): Promise<MergePreview | string> => {
  const cards = await loadCards(
    prisma,
    [input.userResourceId, input.staffResourceId],
    false
  )
  const user = cards.find((card) => card.id === input.userResourceId)
  const staff = cards.find((card) => card.id === input.staffResourceId)
  if (!user || !staff) return BLOCK_MESSAGE.resource_missing
  const links = await loadLinks(prisma, [user.id, staff.id], false)
  const [userCard, staffCard] = withLinks([user, staff], links)
  const cases = recordsOf(
    await prisma.$queryRaw(Prisma.sql`
      SELECT id, target_type, target_id, status, revision
      FROM ops_case
      WHERE status IN ('open', 'waiting_reporter', 'waiting_owner')
        AND (
          (target_type = 'resource' AND target_id = ${staff.id})
          OR (
            target_type = 'link'
            AND target_id IN (
              SELECT id FROM patch_resource_link WHERE resource_id = ${staff.id}
            )
          )
        )
      ORDER BY id ASC
    `)
  ).flatMap((row) => {
    const id = asNumber(row.id)
    const targetId = asNumber(row.target_id)
    const revision = asNumber(row.revision)
    if (id === null || targetId === null || revision === null) return []
    return [
      {
        id,
        targetType: asText(row.target_type),
        targetId,
        status: asText(row.status),
        revision
      } satisfies OpenCaseFact
    ]
  })
  const game = await gameCards(prisma, user.patchId, user.section)
  const overlaid = [
    ...game.filter((card) => card.id !== user.id && card.id !== staff.id),
    userCard,
    staffCard
  ]
  const ids = overlaid.map((card) => card.id)
  const records = await relatedRecords(prisma, ids)
  const record =
    records.find(
      (item) =>
        item.userResourceId === user.id && item.staffResourceId === staff.id
    ) ?? null
  const candidates = buildCandidates(overlaid, records)
  const match = candidates.find(
    (item) => item.user.id === user.id && item.staff.id === staff.id
  )
  const blocks = pairBlocks({
    user: userCard,
    staff: staffCard,
    openCaseIds: cases.map((item) => item.id),
    record,
    userMergedElsewhere: records.some(
      (item) =>
        item.status === 'merged' &&
        item.userResourceId === user.id &&
        item.staffResourceId !== staff.id
    ),
    staffIsSurvivor: records.some(
      (item) => item.status === 'merged' && item.userResourceId === staff.id
    ),
    userIsSurvivor: records.some(
      (item) => item.status === 'merged' && item.userResourceId === user.id
    )
  })
  const notes = mergeNotes(userCard.note, staffCard.note)
  const moves = movedLinkSorts(userCard, staffCard)
  const staffById = new Map(staffCard.links.map((link) => [link.id, link]))
  const staffLikeCount = await prisma.user_patch_resource_like_relation.count({
    where: { resource_id: staffCard.id }
  })
  return {
    classification: match?.pairClass ?? 'manual',
    canMerge: blocks.length === 0,
    blocks,
    basis: mergeBasis({ user: userCard, staff: staffCard, openCases: cases }),
    user: summaryOf(userCard),
    staff: summaryOf(staffCard),
    survivorPreview: {
      name: userCard.name,
      type: userCard.type,
      language: userCard.language,
      platform: userCard.platform,
      note: notes.blocked ? userCard.note : notes.note,
      noteAppended: notes.appended && !notes.blocked,
      links: [
        ...userCard.links.map(publicLink),
        ...moves.flatMap((move) => {
          const link = staffById.get(move.id)
          return link
            ? [publicLink({ ...link, sortOrder: move.sortOrder })]
            : []
        })
      ]
    },
    fieldComparison: comparison(userCard, staffCard),
    staffLikeCount,
    exitedPairs: candidates
      .filter((item) => item.user.id === user.id && item.staff.id !== staff.id)
      .map((item) => ({
        staffResourceId: item.staff.id,
        staffName: item.staff.name,
        retained: true as const
      }))
  }
}

const cardsFrom = (rows: Record<string, unknown>[]) =>
  rows.flatMap((row) => {
    const card = rowCard(row, [])
    return card ? [card] : []
  })

const recordKey = (record: MergeRecordFact) =>
  `${record.userResourceId}:${record.staffResourceId}`

const listFacts = async (input: z.infer<typeof mergeListSchema>) => {
  const sectionSql = input.section
    ? Prisma.sql`r.section = ${input.section}`
    : Prisma.sql`TRUE`
  const historySectionSql = input.section
    ? Prisma.sql`(m.section = ${input.section} OR survivor.section = ${input.section})`
    : Prisma.sql`TRUE`
  const liveRows = recordsOf(
    await prisma.$queryRaw(Prisma.sql`
      /* om:live-cards */
      SELECT ${cardColumns}
      FROM patch_resource r
      JOIN "user" u ON u.id = r.user_id
      JOIN patch p ON p.id = r.patch_id
      WHERE ${sectionSql}
        AND EXISTS (
          SELECT 1 FROM patch_resource other
          JOIN "user" ou ON ou.id = other.user_id
          WHERE other.patch_id = r.patch_id
            AND other.section = r.section
            AND other.id <> r.id
            AND (
              (u.role <= 2 AND ou.role >= 3)
              OR (u.role >= 3 AND ou.role <= 2)
            )
        )
    `)
  )
  const history = await relatedRecordsFrom(
    prisma,
    Prisma.sql`
    /* om:merge-history */
    SELECT m.user_resource_id, m.staff_resource_id, m.patch_id, m.section, m.status, m.detail,
      m.handled_at, m.handled_by_user_id
    FROM patch_resource_merge_record m
    LEFT JOIN patch_resource survivor ON survivor.id = m.user_resource_id
    WHERE ${historySectionSql}
  `
  )
  const liveCards = cardsFrom(liveRows)
  const known = new Set(liveCards.map((card) => card.id))
  const missingIds = [
    ...new Set(
      history.flatMap((record) => [
        record.userResourceId,
        record.staffResourceId
      ])
    )
  ].filter((id) => !known.has(id))
  const extraRows = missingIds.length
    ? recordsOf(
        await prisma.$queryRaw(Prisma.sql`
          /* om:record-cards */
          SELECT ${cardColumns}
          FROM patch_resource r
          JOIN "user" u ON u.id = r.user_id
          JOIN patch p ON p.id = r.patch_id
          WHERE r.id IN (${Prisma.join(missingIds)})
        `)
      )
    : []
  const cards = [...liveCards, ...cardsFrom(extraRows)]
  const links = await loadLinks(
    prisma,
    cards.map((card) => card.id),
    false
  )
  const linked = withLinks(cards, links)
  const liveRecords = await relatedRecords(
    prisma,
    liveCards.map((card) => card.id)
  )
  const recordMap = new Map<string, MergeRecordFact>()
  for (const record of [...history, ...liveRecords]) {
    recordMap.set(recordKey(record), record)
  }
  return { cards: linked, records: [...recordMap.values()] }
}

type ListRow = {
  item: MergeListItem
  /** The user card's author is staff; it is not one of its own options. */
  selfStaff: boolean
  /** Pending: earliest pair wait start. */
  waitSince: Date | null
  /** History: earliest and latest record of this tab. */
  firstHandled: Date | null
  lastHandled: Date | null
  lastHandledStaffId: number | null
  lastHandlerId: number | null
}

const timeOf = (value: Date | null) => (value ? value.getTime() : null)

const ascNullsLast = (left: number | null, right: number | null) => {
  if (left === null || right === null) {
    return left === right ? 0 : left === null ? 1 : -1
  }
  return left - right
}

const descNullsLast = (left: number | null, right: number | null) => {
  if (left === null || right === null) {
    return left === right ? 0 : left === null ? 1 : -1
  }
  return right - left
}

const gameNameCollator = new Intl.Collator('zh-Hans-CN', { numeric: true })

export const defaultMergeSort = (tab: MergeTab): MergeSort =>
  tab === 'pending' ? 'download_desc' : 'handled_desc'

/** Final order is always by user card id ascending. */
const sortListRows = (rows: ListRow[], tab: MergeTab, sort: MergeSort) => {
  const pending = tab === 'pending'
  const byDownload = (left: ListRow, right: ListRow) =>
    right.item.userResource.download - left.item.userResource.download
  const compare = (left: ListRow, right: ListRow) => {
    if (sort === 'waiting_longest') {
      return pending
        ? ascNullsLast(timeOf(left.waitSince), timeOf(right.waitSince))
        : ascNullsLast(timeOf(left.firstHandled), timeOf(right.firstHandled))
    }
    if (sort === 'game_name') {
      return gameNameCollator.compare(
        left.item.userResource.patchName,
        right.item.userResource.patchName
      )
    }
    // Pending rows have no record; handled_desc falls back to downloads.
    if (sort === 'handled_desc' && !pending) {
      return descNullsLast(timeOf(left.lastHandled), timeOf(right.lastHandled))
    }
    return byDownload(left, right)
  }
  return [...rows].sort(
    (left, right) =>
      compare(left, right) ||
      left.item.userResource.id - right.item.userResource.id
  )
}

const emptyListFields = {
  officialCount: 0,
  recommendState: null,
  recommendation: null,
  handledAt: null,
  handledBy: null
} satisfies Partial<MergeListItem>

export const listResourceMerges = async (
  input: z.infer<typeof mergeListSchema>,
  now = new Date()
): Promise<MergeListResponse> => {
  const { cards, records } = await listFacts(input)
  const cardIds = cards.map((card) => card.id)
  const openRows = cardIds.length
    ? recordsOf(
        await prisma.$queryRaw(Prisma.sql`
          /* om:open-staff */
          SELECT DISTINCT resource_id
          FROM (
            SELECT target_id AS resource_id
            FROM ops_case
            WHERE status IN ('open', 'waiting_reporter', 'waiting_owner')
              AND target_type = 'resource'
              AND target_id IN (${Prisma.join(cardIds)})
            UNION
            SELECT l.resource_id
            FROM ops_case c
            JOIN patch_resource_link l ON l.id = c.target_id
            WHERE c.status IN ('open', 'waiting_reporter', 'waiting_owner')
              AND c.target_type = 'link'
              AND l.resource_id IN (${Prisma.join(cardIds)})
          ) open_targets
        `)
      )
    : []
  const openStaffIds = new Set(
    openRows.flatMap((row) => {
      const id = asNumber(row.resource_id)
      return id === null ? [] : [id]
    })
  )
  const facts = mergeFacts(cards, records)
  const candidates = facts.candidates
  const byUser = new Map<number, typeof candidates>()
  for (const pair of candidates) {
    const group = byUser.get(pair.user.id) ?? []
    group.push(pair)
    byUser.set(pair.user.id, group)
  }
  const staffByGame = new Map<string, MirrorCard[]>()
  for (const card of cards) {
    if (!isStaffCandidateCard(card)) continue
    const key = `${card.patchId}:${card.section}`
    const group = staffByGame.get(key) ?? []
    group.push(card)
    staffByGame.set(key, group)
  }
  const openCaseIds = (staffId: number) =>
    openStaffIds.has(staffId) ? [staffId] : []
  const pending: ListRow[] = [...byUser.entries()].map(([, group]) => {
    const user = group[0].user
    // Same facts as the options endpoint. Other-section cards are never
    // mergeable, so the same-section group decides the recommendation.
    const assessment = assessMergeOptions({
      user,
      staffCards: staffByGame.get(`${user.patchId}:${user.section}`) ?? [],
      facts,
      openCaseIds
    })
    const optionById = new Map(
      assessment.options.map((option) => [option.staffId, option])
    )
    const items = group.map((pair) => ({
      staffResourceId: pair.staff.id,
      staffName: pair.staff.name,
      staffStatus: pair.staff.status,
      pairClass: pair.pairClass,
      blocks:
        optionById.get(pair.staff.id)?.blocks ??
        factPairBlocks(facts, pair.user, pair.staff, openCaseIds(pair.staff.id))
    }))
    const pairClass =
      items.length === 1 && items[0].pairClass === 'high' ? 'high' : 'manual'
    const recommended =
      assessment.recommendedStaffId === null
        ? null
        : (optionById.get(assessment.recommendedStaffId) ?? null)
    const waits = group.map((pair) =>
      pairWaitSince(pair.user, pair.staff).getTime()
    )
    return {
      item: {
        ...emptyListFields,
        userResource: summaryOf(user),
        pairClass,
        candidateCount: items.length,
        candidates: items,
        blocks: items.length === 1 ? items[0].blocks : [],
        hasStaffBackup: hasStaffBackup(user),
        recommendState: assessment.state,
        recommendation: recommended
          ? {
              staffResourceId: recommended.staffId,
              staffName: recommended.staff.name
            }
          : null
      },
      selfStaff: false,
      waitSince: new Date(Math.min(...waits)),
      firstHandled: null,
      lastHandled: null,
      lastHandledStaffId: null,
      lastHandlerId: null
    }
  })
  const cardsById = new Map(cards.map((card) => [card.id, card]))
  const grouped = (status: 'dismissed' | 'merged') => {
    const rows = new Map<number, ListRow>()
    for (const record of records.filter((item) => item.status === status)) {
      const user = cardsById.get(record.userResourceId)
      if (!user) continue
      const staff = cardsById.get(record.staffResourceId)
      const row: ListRow = rows.get(user.id) ?? {
        item: {
          ...emptyListFields,
          userResource: summaryOf(user),
          pairClass: 'manual' as const,
          candidateCount: 0,
          candidates: [],
          blocks: [],
          hasStaffBackup: hasStaffBackup(user)
        },
        selfStaff: isStaffCandidateCard(user),
        waitSince: null,
        firstHandled: null,
        lastHandled: null,
        lastHandledStaffId: null,
        lastHandlerId: null
      }
      row.item.candidates.push({
        staffResourceId: record.staffResourceId,
        staffName: recordStaffName(record, staff),
        staffStatus: staff?.status ?? 0,
        pairClass: 'manual',
        blocks:
          status === 'dismissed'
            ? [
                {
                  code: 'pair_dismissed',
                  message: BLOCK_MESSAGE.pair_dismissed
                }
              ]
            : []
      })
      row.item.candidateCount = row.item.candidates.length
      const at = record.handledAt
      if (at) {
        if (!row.firstHandled || at < row.firstHandled) row.firstHandled = at
        const later =
          !row.lastHandled ||
          at > row.lastHandled ||
          (at.getTime() === row.lastHandled.getTime() &&
            record.staffResourceId > (row.lastHandledStaffId ?? 0))
        if (later) {
          row.lastHandled = at
          row.lastHandledStaffId = record.staffResourceId
          row.lastHandlerId = record.handledByUserId
        }
      }
      rows.set(user.id, row)
    }
    return [...rows.values()]
  }
  const search = input.search.trim().toLowerCase()
  const matchesSearch = ({ item }: ListRow) => {
    if (!search) return true
    const fields = [
      item.userResource.name,
      item.userResource.publisher.name,
      item.userResource.patchName,
      ...item.candidates.map((candidate) => candidate.staffName)
    ]
    return fields.some((field) => field.toLowerCase().includes(search))
  }
  const dismissed = grouped('dismissed').filter(matchesSearch)
  const merged = grouped('merged').filter(matchesSearch)
  const visiblePending = pending.filter(matchesSearch)
  const counts = {
    pending: visiblePending.length,
    dismissed: dismissed.length,
    merged: merged.length
  }
  const selected =
    input.tab === 'pending'
      ? visiblePending
      : input.tab === 'dismissed'
        ? dismissed
        : merged
  const filtered = sortListRows(
    input.pairClass
      ? selected.filter((row) => row.item.pairClass === input.pairClass)
      : selected,
    input.tab,
    input.sort ?? defaultMergeSort(input.tab)
  )
  const oldest = candidates.reduce<{ at: Date; id: number } | null>(
    (best, pair) => {
      const at = pairWaitSince(pair.user, pair.staff)
      if (
        !best ||
        at < best.at ||
        (at.getTime() === best.at.getTime() && pair.user.id < best.id)
      ) {
        return { at, id: pair.user.id }
      }
      return best
    },
    null
  )
  const start = (input.page - 1) * input.limit
  const pageRows = filtered.slice(start, start + input.limit)
  const official = await officialCounts([
    ...new Set(pageRows.map((row) => row.item.userResource.patchId))
  ])
  const handlers = await userNames(
    prisma,
    pageRows.flatMap((row) =>
      row.lastHandlerId === null ? [] : [row.lastHandlerId]
    )
  )
  const history = input.tab !== 'pending'
  return {
    items: pageRows.map((row) => ({
      ...row.item,
      officialCount: Math.max(
        0,
        (official.get(row.item.userResource.patchId) ?? 0) -
          (row.selfStaff ? 1 : 0)
      ),
      handledAt:
        history && row.lastHandled ? row.lastHandled.toISOString() : null,
      handledBy:
        history && row.lastHandlerId !== null
          ? (handlers.get(row.lastHandlerId) ?? null)
          : null
    })),
    total: filtered.length,
    page: input.page,
    limit: input.limit,
    counts,
    oldestPending: oldest
      ? {
          resourceId: oldest.id,
          since: oldest.at.toISOString(),
          ageMs: Math.max(0, now.getTime() - oldest.at.getTime())
        }
      : null
  }
}

export const dismissResourceMerge = async (
  input: z.infer<typeof mergePairSchema>,
  actorId: number
) => {
  try {
    return await runResourceMutation(async (tx) => {
      const locked = await loadCards(
        tx,
        [input.userResourceId, input.staffResourceId].sort(
          (left, right) => left - right
        ),
        true
      )
      const record = await readPairRecord(
        tx,
        input.userResourceId,
        input.staffResourceId,
        true
      )
      if (record?.status === 'merged') {
        throw new OfficialMirrorError('这一对已经合并')
      }
      if (record?.status === 'dismissed') {
        return { changed: false }
      }
      const user = locked.find((card) => card.id === input.userResourceId)
      const staff = locked.find((card) => card.id === input.staffResourceId)
      if (!user || !staff)
        throw new OfficialMirrorError(BLOCK_MESSAGE.resource_missing)
      const links = await loadLinks(tx, [user.id, staff.id], true)
      const [userCard, staffCard] = withLinks([user, staff], links)
      if (userCard.publisherLeftAt) {
        throw new OfficialMirrorError(BLOCK_MESSAGE.user_handed_over)
      }
      if (userCard.status !== 0) {
        throw new OfficialMirrorError(BLOCK_MESSAGE.user_not_public)
      }
      if (
        !isUserCandidateCard(userCard) ||
        !isStaffCandidateCard(staffCard) ||
        userCard.patchId !== staffCard.patchId ||
        userCard.section !== staffCard.section
      ) {
        throw new OfficialMirrorError(BLOCK_MESSAGE.not_candidate)
      }
      const records = await relatedRecords(tx, [user.id, staff.id])
      if (
        records.some(
          (item) => item.status === 'merged' && item.userResourceId === staff.id
        )
      ) {
        throw new OfficialMirrorError(BLOCK_MESSAGE.survivor_chain)
      }
      if (
        records.some(
          (item) => item.status === 'merged' && item.userResourceId === user.id
        )
      ) {
        throw new OfficialMirrorError(BLOCK_MESSAGE.already_merged_other)
      }
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO patch_resource_merge_record (
          user_resource_id, staff_resource_id, patch_id, section, status,
          handled_at, handled_by_user_id, detail
        )
        VALUES (
          ${user.id}, ${staff.id}, ${user.patchId}, ${user.section},
          'dismissed', ${sqlTimestamp(new Date())}, ${actorId}, ${JSON.stringify({ contentConfirmed: false })}::jsonb
        )
        ON CONFLICT (user_resource_id, staff_resource_id) DO NOTHING
      `)
      const name = await actorName(tx, actorId)
      await tx.admin_log.create({
        data: {
          type: 'resource_merge_dismiss',
          user_id: actorId,
          content: `管理员 ${name} 驳回了资源 ${user.id} 与站方资源 ${staff.id} 的合并。`
        }
      })
      return { changed: true }
    })
  } catch (error) {
    if (error instanceof OfficialMirrorError) return error.message
    throw error
  }
}

export const reopenResourceMerge = async (
  input: z.infer<typeof mergePairSchema>,
  actorId: number
) => {
  try {
    return await runResourceMutation(async (tx) => {
      await loadCards(
        tx,
        [input.userResourceId, input.staffResourceId].sort(
          (left, right) => left - right
        ),
        true
      )
      const record = await readPairRecord(
        tx,
        input.userResourceId,
        input.staffResourceId,
        true
      )
      if (record?.status === 'merged') {
        throw new OfficialMirrorError('这一对已经合并')
      }
      if (record?.status !== 'dismissed') return { changed: false }
      const deleted = await tx.$executeRaw(Prisma.sql`
        DELETE FROM patch_resource_merge_record
        WHERE user_resource_id = ${input.userResourceId}
          AND staff_resource_id = ${input.staffResourceId}
          AND status = 'dismissed'
      `)
      if (Number(deleted) !== 1) return { changed: false }
      const name = await actorName(tx, actorId)
      await tx.admin_log.create({
        data: {
          type: 'resource_merge_reopen',
          user_id: actorId,
          content: `管理员 ${name} 重开了资源 ${input.userResourceId} 与站方资源 ${input.staffResourceId} 的合并候选。`
        }
      })
      return { changed: true }
    })
  } catch (error) {
    if (error instanceof OfficialMirrorError) return error.message
    throw error
  }
}

/** Fallback names follow the record: merged cards are gone by design. */
const recordStaffName = (record: MergeRecordFact, staff?: MirrorCard) => {
  if (staff) return staff.name
  return record.status === 'merged'
    ? `已合并的站方卡片 ${record.staffResourceId}`
    : `已删除的站方卡片 ${record.staffResourceId}`
}

const movedLinkIdsOf = (detail: unknown) => {
  const parsed = parseMergeDetail(detail)
  if (parsed) return parsed.movedLinkIds
  const source =
    typeof detail === 'string'
      ? (() => {
          try {
            return JSON.parse(detail) as unknown
          } catch {
            return null
          }
        })()
      : detail
  if (!source || typeof source !== 'object') return []
  const ids = (source as { movedLinkIds?: unknown }).movedLinkIds
  return Array.isArray(ids)
    ? ids.filter((id): id is number => typeof id === 'number')
    : []
}

const optionView = (
  option: MergeOptionFact,
  recommendedStaffId: number | null
): MergeOption => ({
  staff: {
    ...summaryOf(option.staff),
    hasStaffBackup: hasStaffBackup(option.staff)
  },
  sameSection: option.sameSection,
  signals: option.signals,
  hits: option.hits,
  recommended: option.staffId === recommendedStaffId,
  highConfidence: option.highConfidence,
  mergeable: option.mergeable,
  dismissable: option.dismissable,
  blocks: option.blocks,
  record: option.record?.status === 'dismissed' ? 'dismissed' : null
})

/**
 * The user card and every staff card (role >= 3) of its game in both
 * sections, any status. Read only; the basis still comes from preview.
 */
export const getMergeOptions = async (
  input: z.infer<typeof mergeOptionsSchema>
): Promise<MergeOptionsResponse | string> => {
  const [found] = await loadCards(prisma, [input.userResourceId], false)
  if (!found) return BLOCK_MESSAGE.resource_missing
  const game = await patchCards(prisma, found.patchId)
  const user =
    game.find((card) => card.id === found.id) ??
    withLinks([found], await loadLinks(prisma, [found.id], false))[0]
  const cards = [...game.filter((card) => card.id !== user.id), user]
  const records = await relatedRecords(
    prisma,
    cards.map((card) => card.id)
  )
  const staffCards = cards.filter(
    (card) => card.id !== user.id && isStaffCandidateCard(card)
  )
  const open = await openCasesByResource(
    prisma,
    staffCards
      .filter((card) => card.section === user.section)
      .map((card) => card.id)
  )
  const facts = mergeFacts(cards, records)
  const assessment = assessMergeOptions({
    user,
    staffCards,
    facts,
    openCaseIds: (staffId) => open.get(staffId) ?? []
  })
  const own = records
    .filter((record) => record.userResourceId === user.id)
    .sort(
      (left, right) =>
        descNullsLast(timeOf(left.handledAt), timeOf(right.handledAt)) ||
        left.staffResourceId - right.staffResourceId
    )
  const known = new Map(cards.map((card) => [card.id, card]))
  const missing = [
    ...new Set(
      own.map((record) => record.staffResourceId).filter((id) => !known.has(id))
    )
  ]
  for (const card of await loadCards(prisma, missing, false)) {
    known.set(card.id, card)
  }
  const handlers = await userNames(
    prisma,
    own.flatMap((record) =>
      record.handledByUserId === null ? [] : [record.handledByUserId]
    )
  )
  const history: MergeHistoryEntry[] = own.map((record) => ({
    staffResourceId: record.staffResourceId,
    staffName: recordStaffName(record, known.get(record.staffResourceId)),
    status: record.status,
    handledAt: record.handledAt ? record.handledAt.toISOString() : '',
    handledBy:
      record.handledByUserId === null
        ? null
        : (handlers.get(record.handledByUserId) ?? null),
    movedLinkIds:
      record.status === 'merged' ? movedLinkIdsOf(record.detail) : []
  }))
  return {
    user: {
      ...summaryOf(user),
      hasStaffBackup: hasStaffBackup(user),
      eligible: assessment.eligible
    },
    recommendState: assessment.state,
    options: assessment.options.map((option) =>
      optionView(option, assessment.recommendedStaffId)
    ),
    history
  }
}

const lockCardRecords = async (
  tx: Prisma.TransactionClient,
  userResourceId: number,
  staffResourceIds: number[]
) => {
  const records = await relatedRecordsFrom(
    tx,
    Prisma.sql`
      /* om:lock-merge-records */
      SELECT ${recordColumns}
      FROM patch_resource_merge_record
      WHERE user_resource_id = ${userResourceId}
        AND staff_resource_id IN (${Prisma.join(staffResourceIds)})
      ORDER BY staff_resource_id ASC
      FOR UPDATE
    `
  )
  return new Map(
    records
      .filter((record) => record.userResourceId === userResourceId)
      .map((record) => [record.staffResourceId, record])
  )
}

/**
 * Dismiss every listed pair of one user card in one transaction. Cards are
 * locked by id ascending, then the pair records, then the links, as in the
 * single dismiss. User-side failures reject the whole request.
 */
export const dismissMergeCard = async (
  input: z.infer<typeof mergeDismissCardSchema>,
  actorId: number
): Promise<MergeDismissCardResult | string> => {
  try {
    return await runResourceMutation(async (tx) => {
      const staffIds = [...new Set(input.staffResourceIds)].sort(
        (left, right) => left - right
      )
      const ids = [...new Set([input.userResourceId, ...staffIds])].sort(
        (left, right) => left - right
      )
      const locked = await loadCards(tx, ids, true)
      const pairRecords = await lockCardRecords(
        tx,
        input.userResourceId,
        staffIds
      )
      if (!locked.some((card) => card.id === input.userResourceId)) {
        throw new OfficialMirrorError(BLOCK_MESSAGE.resource_missing)
      }
      const links = await loadLinks(
        tx,
        locked.map((card) => card.id).sort((left, right) => left - right),
        true
      )
      const cards = withLinks(locked, links)
      const user = cards.find((card) => card.id === input.userResourceId)
      if (!user) throw new OfficialMirrorError(BLOCK_MESSAGE.resource_missing)
      if (user.publisherLeftAt) {
        throw new OfficialMirrorError(BLOCK_MESSAGE.user_handed_over)
      }
      if (user.status !== 0) {
        throw new OfficialMirrorError(BLOCK_MESSAGE.user_not_public)
      }
      if (!isUserCandidateCard(user)) {
        throw new OfficialMirrorError(BLOCK_MESSAGE.not_candidate)
      }
      const records = await relatedRecords(tx, ids)
      const survived = (id: number) =>
        records.some(
          (item) => item.status === 'merged' && item.userResourceId === id
        )
      if (survived(user.id)) {
        throw new OfficialMirrorError(BLOCK_MESSAGE.already_merged_other)
      }
      const result: Omit<MergeDismissCardResult, 'changed'> = {
        dismissed: [],
        unchanged: [],
        skipped: []
      }
      const handledAt = sqlTimestamp(new Date())
      for (const staffId of staffIds) {
        const skip = (reason: string) =>
          result.skipped.push({ staffResourceId: staffId, reason })
        if (staffId === user.id) {
          skip(BLOCK_MESSAGE.not_candidate)
          continue
        }
        const record = pairRecords.get(staffId)
        if (record?.status === 'dismissed') {
          result.unchanged.push(staffId)
          continue
        }
        if (record?.status === 'merged') {
          skip('这一对已经合并')
          continue
        }
        const staff = cards.find((card) => card.id === staffId)
        if (!staff) {
          skip(BLOCK_MESSAGE.resource_missing)
          continue
        }
        if (!isStaffCandidateCard(staff) || staff.patchId !== user.patchId) {
          skip(BLOCK_MESSAGE.not_candidate)
          continue
        }
        if (staff.section !== user.section) {
          skip(BLOCK_MESSAGE.section_mismatch)
          continue
        }
        if (survived(staff.id)) {
          skip(BLOCK_MESSAGE.survivor_chain)
          continue
        }
        const written = await tx.$executeRaw(Prisma.sql`
          INSERT INTO patch_resource_merge_record (
            user_resource_id, staff_resource_id, patch_id, section, status,
            handled_at, handled_by_user_id, detail
          )
          VALUES (
            ${user.id}, ${staff.id}, ${user.patchId}, ${user.section},
            'dismissed', ${handledAt}, ${actorId}, ${JSON.stringify({ contentConfirmed: false })}::jsonb
          )
          ON CONFLICT (user_resource_id, staff_resource_id) DO NOTHING
        `)
        if (Number(written) === 1) result.dismissed.push(staffId)
        else result.unchanged.push(staffId)
      }
      if (result.dismissed.length) {
        const name = await actorName(tx, actorId)
        await tx.admin_log.create({
          data: {
            type: 'resource_merge_dismiss',
            user_id: actorId,
            content: `管理员 ${name} 驳回了资源 ${user.id} 与站方资源 ${result.dismissed.join('、')} 的合并。`
          }
        })
      }
      return { changed: result.dismissed.length > 0, ...result }
    })
  } catch (error) {
    if (error instanceof OfficialMirrorError) return error.message
    throw error
  }
}
