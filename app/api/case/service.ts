import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '~/prisma'
import { getShanghaiQuotaWindows } from '~/app/api/patch/resource/download/access/timeWindow'
import { createMessage } from '~/app/api/utils/message'
import { updatePatchAttributes } from '~/app/api/patch/resource/_helper'
import {
  invalidatePatchContentCache,
  invalidatePatchListCaches
} from '~/app/api/patch/cache'
import {
  CASE_ACTOR_TYPES,
  CASE_CLOSED_STATUSES,
  CASE_CONTENT_ACTIONS,
  CASE_KIND_LABELS,
  CASE_KIND_TARGETS,
  CASE_KINDS,
  CASE_MESSAGE_EVENTS,
  CASE_MESSAGE_KINDS,
  CASE_OWNER_TYPES,
  CASE_PUBLISHER_ESCALATION_AFTER_MS,
  CASE_PUBLISHER_TIMEOUT_KINDS,
  CASE_REPORTER_TIMEOUT_AFTER_MS,
  CASE_REPORTER_TIMEOUT_KINDS,
  CASE_RESOLUTIONS_BY_KIND,
  CASE_REOPEN_WINDOW_MS,
  CASE_RESOLUTIONS,
  CASE_STATUSES,
  CASE_TARGET_TYPES,
  CASE_UNRESOLVED_STATUSES,
  CASE_RESOLUTION_LABELS,
  OPEN_CASE_KINDS
} from '~/constants/case'
import { SHOUTBOX_AUTO_HIDE_REPORTER_THRESHOLD } from '~/constants/shoutbox'
import type {
  CaseActorType,
  CaseContentAction,
  CaseKind,
  CaseMessageEvent,
  CaseMessageKind,
  CaseOwnerType,
  CaseResolution,
  CaseSource,
  CaseStatus,
  CaseTab,
  CaseTargetType
} from '~/constants/case'
import type {
  CaseActionResponse,
  AdminCaseListItem,
  AdminCaseListResponse,
  CaseCapabilities,
  CaseContentActionResponse,
  CaseCreateResponse,
  CaseDetail,
  CaseDetailResponse,
  CaseInboxItem,
  CaseListItem,
  CaseListResponse,
  CaseMessage,
  CaseMessagePayload,
  CaseMessagePreview,
  CaseMessageResponse,
  CasePatchSummary,
  CaseResourceActionResponse,
  CaseReopenResponse,
  CaseResourceSummary,
  CaseStatusCounts,
  CaseSummary,
  CaseTargetSummary,
  CaseUserSummary,
  AdminCaseInboxPayload
} from '~/types/api/case'
import type {
  adminCaseContentSchema,
  adminCaseHandleSchema,
  adminCaseListSchema,
  adminCaseResourceSchema,
  appendCaseMessageSchema,
  caseListSchema,
  createCaseSchema,
  resolveCaseSchema
} from '~/validations/case'
import type { z } from 'zod'

type CaseTx = Prisma.TransactionClient
type CaseDb = PrismaClient | CaseTx
type CreateCaseInput = z.infer<typeof createCaseSchema>
type CaseListInput = z.infer<typeof caseListSchema>
type AppendCaseInput = z.infer<typeof appendCaseMessageSchema>
type ResolveCaseInput = z.infer<typeof resolveCaseSchema>
type AdminListInput = z.infer<typeof adminCaseListSchema>
type AdminHandleInput = z.infer<typeof adminCaseHandleSchema>
type AdminResourceInput = z.infer<typeof adminCaseResourceSchema>
type AdminContentInput = z.infer<typeof adminCaseContentSchema>

const CASE_ID_MAX = 2147483647

/**
 * A domain write can precede the case CAS (resource/content moderation). A
 * plain return from the transaction callback would commit those writes, so
 * these failures deliberately escape the callback and are translated back to
 * the API error string outside the transaction.
 */
class CaseOperationRollbackError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CaseOperationRollbackError'
  }
}

const runCaseOperation = async <T>(
  db: PrismaClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T | string> => {
  try {
    return await db.$transaction(operation)
  } catch (error) {
    if (error instanceof CaseOperationRollbackError) return error.message
    throw error
  }
}

const rollbackCaseOperation = (message: string): never => {
  throw new CaseOperationRollbackError(message)
}

const getUniqueConstraintCode = (error: unknown) => {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current === 'object' && current !== null) {
      const code = (current as { code?: unknown }).code
      if (typeof code === 'string') return code
      current = (current as { cause?: unknown }).cause
    } else {
      break
    }
  }
  return null
}

const invalidateCasePatchCaches = async (
  db: PrismaClient,
  patchIds: readonly (number | null | undefined)[],
  includeList = false
) => {
  const ids = [
    ...new Set(
      patchIds.filter(
        (patchId): patchId is number =>
          typeof patchId === 'number' &&
          Number.isInteger(patchId) &&
          patchId > 0
      )
    )
  ]
  if (ids.length) {
    try {
      const patches = await db.patch.findMany({
        where: { id: { in: ids } },
        select: { unique_id: true }
      })
      const results = await Promise.allSettled(
        patches.map(({ unique_id }) => invalidatePatchContentCache(unique_id))
      )
      for (const result of results) {
        if (result.status === 'rejected') {
          console.error(
            '[Case] Failed to invalidate patch content cache:',
            result.reason
          )
        }
      }
    } catch (error) {
      console.error('[Case] Failed to load patch cache keys:', error)
    }
  }
  if (includeList) {
    try {
      await invalidatePatchListCaches()
    } catch (error) {
      console.error('[Case] Failed to invalidate patch list caches:', error)
    }
  }
}

const invalidateCaseShoutboxCaches = async () => {
  try {
    const { invalidateShoutboxCaches } = await import(
      '~/app/api/shoutbox/cache'
    )
    await invalidateShoutboxCaches()
  } catch (error) {
    console.error('[Case] Failed to invalidate shoutbox caches:', error)
  }
}

const caseSelect = {
  id: true,
  kind: true,
  target_type: true,
  target_id: true,
  patch_id: true,
  owner_type: true,
  owner_id: true,
  status: true,
  resolution: true,
  public: true,
  source: true,
  dedup_key: true,
  daily_key: true,
  revision: true,
  status_changed_at: true,
  queue_entered_at: true,
  closed_at: true,
  escalated_at: true,
  first_owner_response_at: true,
  hidden_at: true,
  restored_at: true,
  reopened_count: true,
  reporter_id: true,
  owner: { select: { id: true, name: true, avatar: true, role: true } },
  reporter: { select: { id: true, name: true, avatar: true, role: true } },
  _count: { select: { subscribers: true } },
  created: true,
  updated: true
} satisfies Prisma.ops_caseSelect

type CaseRow = Prisma.ops_caseGetPayload<{ select: typeof caseSelect }>

const caseLockSelect = {
  id: true,
  kind: true,
  target_type: true,
  target_id: true,
  patch_id: true,
  owner_type: true,
  owner_id: true,
  status: true,
  resolution: true,
  public: true,
  source: true,
  dedup_key: true,
  daily_key: true,
  revision: true,
  status_changed_at: true,
  queue_entered_at: true,
  closed_at: true,
  escalated_at: true,
  first_owner_response_at: true,
  hidden_at: true,
  restored_at: true,
  reopened_count: true,
  reporter_id: true,
  owner: { select: { id: true, name: true, avatar: true, role: true } },
  reporter: { select: { id: true, name: true, avatar: true, role: true } },
  _count: { select: { subscribers: true } },
  created: true,
  updated: true
} satisfies Prisma.ops_caseSelect

const messageSelect = {
  id: true,
  kind: true,
  event: true,
  payload: true,
  body: true,
  created: true,
  author: { select: { id: true, name: true, avatar: true, role: true } }
} satisfies Prisma.ops_case_messageSelect

type CaseMessageRow = Prisma.ops_case_messageGetPayload<{
  select: typeof messageSelect
}>

const caseListSelect = {
  ...caseSelect,
  messages: {
    orderBy: [{ created: 'desc' }, { id: 'desc' }],
    take: 1,
    select: {
      id: true,
      kind: true,
      event: true,
      body: true,
      created: true
    }
  }
} satisfies Prisma.ops_caseSelect

const userSelect = { id: true, name: true, avatar: true, role: true } as const
const unresolvedStatuses = [...CASE_UNRESOLVED_STATUSES]
const closedStatuses = [...CASE_CLOSED_STATUSES]

const iso = (value: Date | string | null | undefined) => {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

const isCaseKind = (value: string): value is CaseKind =>
  (CASE_KINDS as readonly string[]).includes(value)
const isCaseTargetType = (value: string): value is CaseTargetType =>
  (CASE_TARGET_TYPES as readonly string[]).includes(value)
const isCaseOwnerType = (value: string): value is CaseOwnerType =>
  (CASE_OWNER_TYPES as readonly string[]).includes(value)
const isCaseStatus = (value: string): value is CaseStatus =>
  (CASE_STATUSES as readonly string[]).includes(value)
const isCaseResolution = (value: string): value is CaseResolution =>
  (CASE_RESOLUTIONS as readonly string[]).includes(value)

const asInputJson = (value: Record<string, unknown> | null | undefined) =>
  value === undefined || value === null
    ? undefined
    : (value as Prisma.InputJsonValue)

const dateKey = (now: Date) => {
  const { dailyStart } = getShanghaiQuotaWindows(now)
  const shanghai = new Date(dailyStart.getTime() + 8 * 60 * 60 * 1000)
  return shanghai.toISOString().slice(0, 10)
}

export const buildCaseDedupKey = (
  targetType: CaseTargetType,
  targetId: number,
  kind: CaseKind
) => `${targetType}:${targetId}:${kind}`

export const buildCaseDailyKey = (
  userId: number,
  targetType: CaseTargetType,
  targetId: number,
  now = new Date()
) => `${userId}:${targetType}:${targetId}:${dateKey(now)}`

const toUser = (user: { id: number; name: string; avatar: string } | null) =>
  user ? { id: user.id, name: user.name, avatar: user.avatar } : null

const targetSummary = (input: {
  targetType: CaseTargetType
  targetId: number
  patch?: CasePatchSummary | null
  resource?: CaseResourceSummary | null
  status?: number
  deleted?: boolean
}) =>
  ({
    targetType: input.targetType,
    targetId: input.targetId,
    deleted: input.deleted ?? (input.resource === null && input.patch === null),
    ...(input.status === undefined ? {} : { status: input.status }),
    patch: input.patch ?? null,
    resource: input.resource ?? null
  }) satisfies CaseTargetSummary

type DerivedTarget = {
  targetType: CaseTargetType
  targetId: number
  patchId: number | null
  ownerType: CaseOwnerType
  ownerId: number | null
  public: boolean
  target: CaseTargetSummary
}

const patchSummary = (
  patch: {
    id: number
    unique_id: string
    name: string
  } | null
): CasePatchSummary | null =>
  patch ? { id: patch.id, uniqueId: patch.unique_id, name: patch.name } : null

const deriveTarget = async (
  tx: CaseTx,
  input: {
    kind: CaseKind
    targetType: CaseTargetType
    targetId: number
    expectedPatchId?: number
    reporterId?: number | null
    now?: Date
    allowFrozen?: boolean
  }
): Promise<DerivedTarget | string> => {
  const { kind, targetType, targetId, expectedPatchId, reporterId } = input
  if (!isCaseKind(kind) || !isCaseTargetType(targetType)) {
    return '问题类型或目标类型不合法'
  }
  const allowed = (CASE_KIND_TARGETS as Record<string, readonly string[]>)[kind]
  if (!input.allowFrozen && (!allowed || !allowed.includes(targetType))) {
    return '当前问题类型暂不支持该目标'
  }

  if (targetType === 'resource') {
    const resource = await tx.patch_resource.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        name: true,
        section: true,
        patch_id: true,
        status: true,
        user_id: true,
        user: { select: { role: true } },
        patch: { select: { id: true, unique_id: true, name: true } }
      }
    })
    if (!resource) return '资源不存在'
    if (resource.status !== 0) return '该资源当前不可举报'
    if (
      expectedPatchId !== undefined &&
      expectedPatchId !== resource.patch_id
    ) {
      return '该资源已被移动，请刷新后重试'
    }
    // Only the public resource mismatch flow belongs to the publisher. Wrong
    // patch and the frozen resource violation flow are station cases even
    // when the resource author is an ordinary publisher.
    const publisherOwned =
      kind === 'resource_mismatch' && resource.user.role <= 2
    const ownerType: CaseOwnerType = publisherOwned ? 'publisher' : 'staff'
    const ownerId = publisherOwned ? resource.user_id : null
    return {
      targetType,
      targetId,
      patchId: resource.patch_id,
      ownerType,
      ownerId,
      public: kind === 'resource_mismatch',
      target: targetSummary({
        targetType,
        targetId,
        patch: patchSummary(resource.patch),
        resource: {
          id: resource.id,
          name: resource.name,
          section: resource.section,
          patchId: resource.patch_id,
          patch: patchSummary(resource.patch),
          status: resource.status
        }
      })
    }
  }

  if (targetType === 'patch') {
    const patch = await tx.patch.findUnique({
      where: { id: targetId },
      select: { id: true, unique_id: true, name: true, status: true }
    })
    if (!patch || patch.status !== 0) return '条目不存在或不可用'
    if (expectedPatchId !== undefined && expectedPatchId !== patch.id) {
      return '条目上下文已变化，请刷新后重试'
    }
    return {
      targetType,
      targetId,
      patchId: patch.id,
      ownerType: 'staff',
      ownerId: null,
      public: false,
      target: targetSummary({
        targetType,
        targetId,
        patch: patchSummary(patch),
        resource: null
      })
    }
  }

  if (targetType === 'comment' || targetType === 'rating') {
    const row =
      targetType === 'comment'
        ? await tx.patch_comment.findUnique({
            where: { id: targetId },
            select: {
              id: true,
              user_id: true,
              patch_id: true,
              patch: {
                select: { id: true, unique_id: true, name: true, status: true }
              }
            }
          })
        : await tx.patch_rating.findUnique({
            where: { id: targetId },
            select: {
              id: true,
              user_id: true,
              patch_id: true,
              patch: {
                select: { id: true, unique_id: true, name: true, status: true }
              }
            }
          })
    if (!row) return targetType === 'comment' ? '评论不存在' : '评价不存在'
    if (row.patch.status !== 0) return '该条目不可用'
    if (expectedPatchId !== undefined && expectedPatchId !== row.patch_id) {
      return targetType === 'comment'
        ? '评论不属于当前游戏'
        : '评价不属于当前游戏'
    }
    if (reporterId !== undefined && row.user_id === reporterId) {
      return targetType === 'comment'
        ? '不能举报自己的评论'
        : '不能举报自己的评价'
    }
    return {
      targetType,
      targetId,
      patchId: row.patch_id,
      ownerType: 'staff',
      ownerId: null,
      public: false,
      target: targetSummary({
        targetType,
        targetId,
        patch: patchSummary(row.patch),
        resource: null
      })
    }
  }

  if (targetType === 'shoutbox') {
    const shoutbox = await tx.shoutbox.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        user_id: true,
        patch_id: true,
        status: true,
        official: true,
        effective_from: true,
        patch: { select: { id: true, unique_id: true, name: true } },
        user: { select: { role: true } }
      }
    })
    if (!shoutbox) return '小喇叭不存在'
    if (reporterId !== undefined && shoutbox.user_id === reporterId) {
      return '不能举报自己的小喇叭'
    }
    if (shoutbox.user.role === 4) return '超级管理员发布的小喇叭不能举报'
    const notYetEffective =
      shoutbox.official &&
      shoutbox.effective_from !== null &&
      shoutbox.effective_from.getTime() > (input.now ?? new Date()).getTime()
    if (shoutbox.status === 1 || shoutbox.status === 3 || notYetEffective) {
      return '当前小喇叭不接受举报'
    }
    if (shoutbox.status !== 0 && shoutbox.status !== 2) {
      return '当前小喇叭不接受举报'
    }
    return {
      targetType,
      targetId,
      patchId: shoutbox.patch_id,
      ownerType: 'staff',
      ownerId: null,
      public: false,
      target: targetSummary({
        targetType,
        targetId,
        patch: patchSummary(shoutbox.patch),
        resource: null
      })
    }
  }

  if (targetType === 'user') {
    if (reporterId !== undefined && reporterId === targetId) {
      return '不能举报自己'
    }
    const user = await tx.user.findUnique({
      where: { id: targetId },
      select: { id: true }
    })
    if (!user) return '用户不存在'
    return {
      targetType,
      targetId,
      patchId: null,
      ownerType: 'staff',
      ownerId: null,
      public: false,
      target: targetSummary({
        targetType,
        targetId,
        patch: null,
        resource: null
      })
    }
  }

  return '当前模块尚未开放该目标'
}

const getCaseById = (db: CaseDb, id: number) =>
  db.ops_case.findUnique({ where: { id }, select: caseSelect })

const getCaseLock = async (tx: CaseTx, id: number) => {
  if (typeof tx.$queryRaw === 'function') {
    const rows = await tx.$queryRaw<CaseRow[]>(Prisma.sql`
      SELECT id, kind, target_type, target_id, patch_id, owner_type, owner_id,
             status, resolution, public, source, dedup_key, daily_key, revision,
             status_changed_at, queue_entered_at, closed_at, escalated_at,
             first_owner_response_at, hidden_at, restored_at, reopened_count,
             reporter_id, created, updated
      FROM ops_case
      WHERE id = ${id}
      FOR UPDATE
    `)
    if (Array.isArray(rows) && !rows[0]) return null
    if (!Array.isArray(rows)) {
      return tx.ops_case.findUnique({ where: { id }, select: caseLockSelect })
    }
    return tx.ops_case.findUnique({ where: { id }, select: caseLockSelect })
  }
  return tx.ops_case.findUnique({ where: { id }, select: caseLockSelect })
}

type TargetRows = {
  targetExists?: boolean
  patch?: {
    id: number
    unique_id: string
    name: string
  } | null
  resource?: {
    id: number
    name: string
    section: string
    patch_id: number
    user_id: number
    status: number
    patch: { id: number; unique_id: string; name: string } | null
  } | null
  shoutbox?: {
    status: number
  } | null
}

const loadTarget = async (
  db: CaseDb,
  row: Pick<CaseRow, 'target_type' | 'target_id' | 'patch_id'>
): Promise<TargetRows> => {
  if (row.target_type === 'resource') {
    const resource = await db.patch_resource.findUnique({
      where: { id: row.target_id },
      select: {
        id: true,
        name: true,
        section: true,
        patch_id: true,
        user_id: true,
        status: true,
        patch: { select: { id: true, unique_id: true, name: true } }
      }
    })
    return { targetExists: Boolean(resource), resource }
  }
  if (row.target_type === 'patch') {
    const patch = await db.patch.findUnique({
      where: { id: row.target_id },
      select: { id: true, unique_id: true, name: true }
    })
    return {
      targetExists: Boolean(patch),
      patch
    }
  }
  const patch = row.patch_id
    ? await db.patch.findUnique({
        where: { id: row.patch_id },
        select: { id: true, unique_id: true, name: true }
      })
    : null
  let targetExists = false
  if (row.target_type === 'comment') {
    targetExists = Boolean(
      await db.patch_comment.findUnique({
        where: { id: row.target_id },
        select: { id: true }
      })
    )
  } else if (row.target_type === 'rating') {
    targetExists = Boolean(
      await db.patch_rating.findUnique({
        where: { id: row.target_id },
        select: { id: true }
      })
    )
  } else if (row.target_type === 'shoutbox') {
    const shoutbox = await db.shoutbox.findUnique({
      where: { id: row.target_id },
      select: { id: true, status: true }
    })
    targetExists = Boolean(shoutbox)
    return {
      targetExists,
      patch,
      shoutbox: shoutbox ? { status: shoutbox.status } : null
    }
  } else if (row.target_type === 'user') {
    targetExists = Boolean(
      await db.user.findUnique({
        where: { id: row.target_id },
        select: { id: true }
      })
    )
  }
  return { targetExists, patch }
}

const queryManyIfNeeded = async <T>(
  ids: readonly number[],
  query: () => Promise<T[]>
) => (ids.length ? query() : [])

/**
 * List endpoints return at most 100 rows. Resolve their polymorphic targets in
 * bounded batches instead of issuing one target query per case row.
 */
const loadTargets = async (db: CaseDb, rows: readonly CaseRow[]) => {
  const resourceIds = rows
    .filter((row) => row.target_type === 'resource')
    .map((row) => row.target_id)
  const patchTargetIds = rows
    .filter((row) => row.target_type === 'patch')
    .map((row) => row.target_id)
  const patchIds = [
    ...new Set(
      rows
        .map((row) => row.patch_id)
        .filter((patchId): patchId is number => patchId !== null)
        .concat(patchTargetIds)
    )
  ]
  const commentIds = rows
    .filter((row) => row.target_type === 'comment')
    .map((row) => row.target_id)
  const ratingIds = rows
    .filter((row) => row.target_type === 'rating')
    .map((row) => row.target_id)
  const shoutboxIds = rows
    .filter((row) => row.target_type === 'shoutbox')
    .map((row) => row.target_id)
  const userIds = rows
    .filter((row) => row.target_type === 'user')
    .map((row) => row.target_id)

  const [resources, patches, comments, ratings, shoutboxes, users] =
    await Promise.all([
      queryManyIfNeeded(resourceIds, () =>
        db.patch_resource.findMany({
          where: { id: { in: resourceIds } },
          select: {
            id: true,
            name: true,
            section: true,
            patch_id: true,
            user_id: true,
            status: true,
            patch: { select: { id: true, unique_id: true, name: true } }
          }
        })
      ),
      queryManyIfNeeded(patchIds, () =>
        db.patch.findMany({
          where: { id: { in: patchIds } },
          select: { id: true, unique_id: true, name: true }
        })
      ),
      queryManyIfNeeded(commentIds, () =>
        db.patch_comment.findMany({
          where: { id: { in: commentIds } },
          select: { id: true }
        })
      ),
      queryManyIfNeeded(ratingIds, () =>
        db.patch_rating.findMany({
          where: { id: { in: ratingIds } },
          select: { id: true }
        })
      ),
      queryManyIfNeeded(shoutboxIds, () =>
        db.shoutbox.findMany({
          where: { id: { in: shoutboxIds } },
          select: { id: true, status: true }
        })
      ),
      queryManyIfNeeded(userIds, () =>
        db.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true }
        })
      )
    ])

  const resourceById = new Map(
    resources.map((resource) => [resource.id, resource])
  )
  const patchById = new Map(patches.map((patch) => [patch.id, patch]))
  const commentIdsFound = new Set(comments.map((comment) => comment.id))
  const ratingIdsFound = new Set(ratings.map((rating) => rating.id))
  const shoutboxById = new Map(
    shoutboxes.map((shoutbox) => [shoutbox.id, shoutbox])
  )
  const userIdsFound = new Set(users.map((user) => user.id))
  const targetByCaseId = new Map<number, TargetRows>()

  for (const row of rows) {
    const patch = row.patch_id ? (patchById.get(row.patch_id) ?? null) : null
    if (row.target_type === 'resource') {
      const resource = resourceById.get(row.target_id) ?? null
      targetByCaseId.set(row.id, {
        targetExists: resource !== null,
        resource
      })
      continue
    }
    if (row.target_type === 'patch') {
      const target = patchById.get(row.target_id) ?? null
      targetByCaseId.set(row.id, {
        targetExists: target !== null,
        patch: target
      })
      continue
    }
    if (row.target_type === 'comment') {
      targetByCaseId.set(row.id, {
        targetExists: commentIdsFound.has(row.target_id),
        patch
      })
      continue
    }
    if (row.target_type === 'rating') {
      targetByCaseId.set(row.id, {
        targetExists: ratingIdsFound.has(row.target_id),
        patch
      })
      continue
    }
    if (row.target_type === 'shoutbox') {
      const shoutbox = shoutboxById.get(row.target_id)
      targetByCaseId.set(row.id, {
        targetExists: shoutbox !== undefined,
        patch,
        shoutbox: shoutbox ? { status: shoutbox.status } : null
      })
      continue
    }
    if (row.target_type === 'user') {
      targetByCaseId.set(row.id, {
        targetExists: userIdsFound.has(row.target_id),
        patch
      })
      continue
    }
    targetByCaseId.set(row.id, { targetExists: false, patch })
  }
  return targetByCaseId
}

const toMessagePreview = (
  row: Pick<CaseMessageRow, 'id' | 'kind' | 'event' | 'body' | 'created'>
): CaseMessagePreview => ({
  id: row.id,
  kind: (CASE_MESSAGE_KINDS as readonly string[]).includes(row.kind)
    ? (row.kind as CaseMessageKind)
    : 'reply',
  event:
    row.event && (CASE_MESSAGE_EVENTS as readonly string[]).includes(row.event)
      ? (row.event as CaseMessageEvent)
      : null,
  body: row.body,
  created: iso(row.created) ?? new Date(0).toISOString()
})

const toTargetSummary = (
  row: Pick<CaseRow, 'target_type' | 'target_id' | 'patch_id'>,
  target: TargetRows
) => {
  const targetType = isCaseTargetType(row.target_type)
    ? row.target_type
    : ('patch' as const)
  if (targetType === 'resource') {
    const resource = target.resource
    return targetSummary({
      targetType,
      targetId: row.target_id,
      patch: patchSummary(resource?.patch ?? null),
      resource: resource
        ? {
            id: resource.id,
            name: resource.name,
            section: resource.section,
            patchId: resource.patch_id,
            patch: patchSummary(resource.patch),
            status: resource.status
          }
        : null,
      deleted: target.targetExists === false
    })
  }
  if (targetType === 'shoutbox') {
    return targetSummary({
      targetType,
      targetId: row.target_id,
      patch: patchSummary(target.patch ?? null),
      resource: null,
      status: target.shoutbox?.status,
      deleted: target.targetExists === false
    })
  }
  return targetSummary({
    targetType,
    targetId: row.target_id,
    patch: patchSummary(target.patch ?? null),
    resource: null,
    deleted: target.targetExists === false
  })
}

const sanitizePayload = (
  payload: Prisma.JsonValue | null
): CaseMessagePayload | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null
  return payload as CaseMessagePayload
}

const serializeMessage = (
  row: CaseMessageRow,
  options: {
    identifyReporter: boolean
    reporterId?: number | null
    includePayload: boolean
  }
): CaseMessage => {
  const author = row.author ? toUser(row.author) : null
  const safeAuthor =
    row.author &&
    !options.identifyReporter &&
    options.reporterId !== null &&
    options.reporterId !== undefined &&
    row.author.id === options.reporterId
      ? null
      : author
  return {
    id: row.id,
    kind: (CASE_MESSAGE_KINDS as readonly string[]).includes(row.kind)
      ? (row.kind as CaseMessageKind)
      : 'reply',
    event:
      row.event &&
      (CASE_MESSAGE_EVENTS as readonly string[]).includes(row.event)
        ? (row.event as CaseMessageEvent)
        : null,
    body: row.body,
    author: safeAuthor,
    ...(options.includePayload
      ? { payload: sanitizePayload(row.payload) }
      : {}),
    created: iso(row.created) ?? new Date(0).toISOString()
  }
}

const toSummary = (
  row: CaseRow,
  target: TargetRows,
  options: {
    viewerId?: number
    viewerRole?: number
    identifyReporter: boolean
    includeCount: boolean
    includeOwner: boolean
    includeReporter: boolean
  }
): CaseSummary => {
  const kind = isCaseKind(row.kind) ? row.kind : 'other'
  const targetType = isCaseTargetType(row.target_type)
    ? row.target_type
    : 'patch'
  const ownerType = isCaseOwnerType(row.owner_type) ? row.owner_type : 'staff'
  const source = [
    'user',
    'system',
    'publisher_convert',
    'help_escalation'
  ].includes(row.source)
    ? (row.source as CaseSource)
    : 'system'
  const summary: CaseSummary = {
    id: row.id,
    kind,
    targetType,
    targetId: row.target_id,
    target: toTargetSummary(row, target),
    patchId: row.patch_id,
    ownerType,
    ...(options.includeOwner
      ? { owner: toUser(row.owner) && { ...toUser(row.owner)! } }
      : { owner: null }),
    ...(options.includeReporter ? { reporter: toUser(row.reporter) } : {}),
    status: isCaseStatus(row.status) ? row.status : 'open',
    resolution:
      row.resolution && isCaseResolution(row.resolution)
        ? row.resolution
        : null,
    public: row.public,
    source,
    subscriberCount: options.includeCount ? row._count.subscribers : null,
    reopenedCount: row.reopened_count,
    escalatedAt: iso(row.escalated_at),
    firstOwnerResponseAt: iso(row.first_owner_response_at),
    closedAt: iso(row.closed_at),
    statusChangedAt: iso(row.status_changed_at) ?? new Date(0).toISOString(),
    queueEnteredAt: iso(row.queue_entered_at) ?? new Date(0).toISOString(),
    hiddenAt: iso(row.hidden_at),
    restoredAt: iso(row.restored_at),
    created: iso(row.created) ?? new Date(0).toISOString(),
    updated: iso(row.updated) ?? new Date(0).toISOString()
  }
  return summary
}

const canViewCase = (
  row: Pick<
    CaseRow,
    | 'public'
    | 'reporter_id'
    | 'owner_type'
    | 'owner_id'
    | 'kind'
    | 'target_type'
    | 'escalated_at'
  > & {
    subscribers?: Array<{ user_id: number }>
  },
  viewerId: number,
  viewerRole: number,
  subscribed: boolean,
  originalPublisherId?: number
) => {
  if (viewerRole >= 3) return 'admin' as const
  if (row.reporter_id === viewerId) return 'reporter' as const
  if (row.owner_type === 'publisher' && row.owner_id === viewerId) {
    return 'publisher' as const
  }
  if (
    row.public &&
    row.owner_type === 'staff' &&
    row.escalated_at !== null &&
    originalPublisherId === viewerId
  ) {
    return 'publisher-readonly' as const
  }
  if (subscribed && row.public) return 'subscriber-public' as const
  if (subscribed && !row.public) return 'subscriber-private' as const
  return null
}

const capabilitiesFor = (
  row: CaseRow,
  viewerId: number,
  viewerRole: number,
  target?: TargetRows
): CaseCapabilities => {
  const unresolved = unresolvedStatuses.includes(row.status as never)
  const owner = row.owner_type === 'publisher' && row.owner_id === viewerId
  const admin = viewerRole >= 3
  const allowedResolutions: CaseResolution[] =
    !isCaseKind(row.kind) || (!admin && !owner)
      ? []
      : row.kind === 'resource_mismatch'
        ? row.owner_type === 'staff' && row.escalated_at !== null
          ? ['escalated_ignored']
          : ['repaired', 'unreproducible', 'out_of_scope']
        : row.kind === 'resource_wrong_patch'
          ? ['not_established']
          : row.kind === 'content_violation'
            ? row.target_type === 'user' && viewerRole >= 4
              ? ['not_established', 'handled']
              : ['not_established']
            : row.kind === 'other'
              ? ['handled', 'out_of_scope']
              : [...CASE_RESOLUTIONS_BY_KIND[row.kind]]
  const allowedContentActions: CaseContentAction[] =
    !admin ||
    !unresolved ||
    row.kind !== 'content_violation' ||
    row.target_type === 'user' ||
    row.target_type === 'resource'
      ? []
      : row.target_type === 'comment' || row.target_type === 'rating'
        ? ['delete']
        : row.target_type === 'shoutbox' && target?.shoutbox
          ? target.shoutbox.status === 2
            ? ['takedown', 'restore']
            : target.shoutbox.status === 0
              ? ['takedown']
              : target.shoutbox.status === 3
                ? ['restore']
                : []
          : row.target_type === 'shoutbox'
            ? ['takedown']
            : ['delete']
  return {
    canReply: unresolved && (admin || owner || row.reporter_id === viewerId),
    canResolve: unresolved && allowedResolutions.length > 0 && (admin || owner),
    canReopen:
      row.reporter_id === viewerId &&
      closedStatuses.includes(row.status as never) &&
      row.reopened_count === 0 &&
      row.closed_at !== null &&
      row.closed_at.getTime() >= Date.now() - CASE_REOPEN_WINDOW_MS,
    canHideResource:
      admin &&
      unresolved &&
      ((row.kind === 'resource_mismatch' &&
        row.owner_type === 'staff' &&
        row.escalated_at !== null) ||
        (row.kind === 'content_violation' && row.target_type === 'resource')),
    canRestoreResource:
      admin &&
      closedStatuses.includes(row.status as never) &&
      (row.resolution === 'escalated_hidden' ||
        row.resolution === 'violation_hidden') &&
      row.hidden_at !== null &&
      row.restored_at === null,
    canMoveResource: admin && unresolved && row.kind === 'resource_wrong_patch',
    canHandleContent: allowedContentActions.length > 0,
    canConfirmUserHandled:
      admin &&
      viewerRole >= 4 &&
      unresolved &&
      row.kind === 'content_violation' &&
      row.target_type === 'user',
    allowedContentActions,
    allowedResolutions
  }
}

const listViewOptions = (
  row: CaseRow,
  viewerId: number,
  viewerRole: number,
  subscribed: boolean,
  originalPublisherId?: number
) => {
  const view = canViewCase(
    row,
    viewerId,
    viewerRole,
    subscribed,
    originalPublisherId
  )
  if (!view) return null
  const identifyReporter = view === 'admin' || view === 'reporter'
  const full =
    view === 'admin' ||
    view === 'reporter' ||
    view === 'publisher' ||
    view === 'publisher-readonly'
  return {
    view,
    identifyReporter,
    includeCount: full || view === 'subscriber-public',
    includeOwner:
      view === 'admin' || view === 'reporter' || view === 'publisher',
    includeReporter: identifyReporter
  }
}

const serializeSummaryForViewer = async (
  db: CaseDb,
  row: CaseRow,
  viewerId: number,
  viewerRole: number,
  subscribed: boolean,
  suppliedTarget?: TargetRows
) => {
  const target = suppliedTarget ?? (await loadTarget(db, row))
  const options = listViewOptions(
    row,
    viewerId,
    viewerRole,
    subscribed,
    target.resource?.user_id
  )
  if (!options) return null
  return {
    summary: toSummary(row, target, options),
    view: options.view,
    target
  }
}

const caseLink = (id: number) => `/issue/${id}`

const notifyCaseUsers = async (
  tx: CaseTx,
  caseId: number,
  recipientIds: number[],
  content: string,
  senderId?: number | null,
  link = caseLink(caseId)
) => {
  const ids = [
    ...new Set(recipientIds.filter((id) => Number.isInteger(id) && id > 0))
  ]
  if (!ids.length) return
  await tx.user_message.createMany({
    data: ids.map((recipientId) => ({
      type: 'system',
      content,
      sender_id: senderId ?? null,
      recipient_id: recipientId,
      link
    }))
  })
}

const notifyCaseParticipants = async (
  tx: CaseTx,
  row: CaseRow,
  content: string,
  senderId?: number | null
) => {
  const recipients = new Map<
    number,
    { link: string; senderId: number | null; priority: number }
  >()
  const linkPriority = (link: string) =>
    link === `/dashboard/case/${row.id}` ? 3 : link === caseLink(row.id) ? 2 : 1
  const addRecipient = (
    recipientId: number | null | undefined,
    link: string,
    recipientSenderId: number | null = null
  ) => {
    if (
      !Number.isInteger(recipientId) ||
      recipientId === undefined ||
      recipientId === null ||
      recipientId <= 0
    )
      return
    const existing = recipients.get(recipientId)
    const priority = linkPriority(link)
    // A user can be both a public participant and a station administrator.
    // Keep one row and prefer station, then a readable case link, then a
    // target link for an author who is not a case participant.
    if (!existing || priority > existing.priority) {
      recipients.set(recipientId, {
        link,
        senderId: recipientSenderId,
        priority
      })
    }
  }
  if (row.reporter_id !== null) addRecipient(row.reporter_id, caseLink(row.id))
  if (row.owner_type === 'publisher' && row.owner_id !== null) {
    addRecipient(row.owner_id, caseLink(row.id))
  }
  const subscribers = await tx.ops_case_subscriber.findMany({
    where: { case_id: row.id },
    select: { user_id: true }
  })
  for (const { user_id } of subscribers) addRecipient(user_id, caseLink(row.id))
  if (row.target_type === 'resource') {
    const resource = await tx.patch_resource.findUnique({
      where: { id: row.target_id },
      select: {
        user_id: true,
        patch: { select: { unique_id: true } }
      }
    })
    const authorLink = row.public
      ? caseLink(row.id)
      : resource?.patch?.unique_id
        ? `/${resource.patch.unique_id}`
        : null
    if (authorLink && resource) addRecipient(resource.user_id, authorLink)
  }
  if (row.owner_type === 'staff') {
    const admins = await tx.user.findMany({
      where: { role: { gte: 3 } },
      select: { id: true }
    })
    for (const { id } of admins) {
      addRecipient(id, `/dashboard/case/${row.id}`, senderId ?? null)
    }
  }
  if (!recipients.size) return
  await tx.user_message.createMany({
    data: [...recipients].map(([recipient_id, value]) => ({
      type: 'system',
      content,
      sender_id: value.senderId,
      recipient_id,
      link: value.link
    }))
  })
}

const lockResource = async (tx: CaseTx, resourceId: number) => {
  if (typeof tx.$queryRaw === 'function') {
    const rows = await tx.$queryRaw<
      Array<{
        id: number
        patch_id: number
        status: number
        user_id: number
      }>
    >(Prisma.sql`
      SELECT id, patch_id, status, user_id
      FROM patch_resource
      WHERE id = ${resourceId}
      FOR UPDATE
    `)
    if (!Array.isArray(rows)) {
      return tx.patch_resource.findUnique({
        where: { id: resourceId },
        select: { id: true, patch_id: true, status: true, user_id: true }
      })
    }
    return rows[0] ?? null
  }
  return tx.patch_resource.findUnique({
    where: { id: resourceId },
    select: { id: true, patch_id: true, status: true, user_id: true }
  })
}

type InternalCaseOpenInput = {
  kind: CaseKind
  targetType: CaseTargetType
  targetId: number
  reporterId?: number | null
  content?: string
  source?: CaseSource
  expectedPatchId?: number
  now?: Date
  allowFrozen?: boolean
}

const applyShoutboxThreshold = async (
  tx: CaseTx,
  targetType: CaseTargetType,
  targetId: number,
  caseId: number,
  now: Date
) => {
  if (targetType !== 'shoutbox') return false
  const count = await tx.ops_case_subscriber.count({
    where: { case_id: caseId }
  })
  if (count < SHOUTBOX_AUTO_HIDE_REPORTER_THRESHOLD) return false
  const { temporarilyHideShoutboxForCase } = await import(
    '~/app/api/shoutbox/service'
  )
  return temporarilyHideShoutboxForCase(tx, targetId, now)
}

/** Open or subscribe to a case within an existing transaction. */
export const openCaseInternal = async (
  tx: CaseTx,
  input: InternalCaseOpenInput
) => {
  const now = input.now ?? new Date()
  // Resource creation must use the same row lock as resource moves. This
  // keeps the derived patch_id valid until the case/subscriber write ends and
  // preserves the resource -> case lock order.
  if (input.targetType === 'resource') {
    const resource = await lockResource(tx, input.targetId)
    if (!resource) return '资源不存在'
  }
  const derived = await deriveTarget(tx, input)
  if (typeof derived === 'string') return derived
  const dedupKey = buildCaseDedupKey(
    input.targetType,
    input.targetId,
    input.kind
  )
  const source = input.source ?? 'system'
  const dailyKey =
    input.reporterId !== null &&
    input.reporterId !== undefined &&
    derived.ownerType === 'publisher' &&
    source === 'user'
      ? buildCaseDailyKey(
          input.reporterId,
          input.targetType,
          input.targetId,
          now
        )
      : null
  const existing = await tx.ops_case.findUnique({
    where: { dedup_key: dedupKey },
    select: { id: true, status: true, reporter_id: true }
  })
  if (existing) {
    const locked = await getCaseLock(tx, existing.id)
    if (!locked) return '问题不存在'
    if (!unresolvedStatuses.includes(locked.status as never)) {
      return {
        justClosed: true,
        caseId: locked.id,
        created: false,
        subscribed: false
      }
    }
    let subscribed = false
    if (input.reporterId !== null && input.reporterId !== undefined) {
      const result = await tx.ops_case_subscriber.createMany({
        data: [{ case_id: existing.id, user_id: input.reporterId }],
        skipDuplicates: true
      })
      subscribed = result.count > 0
    }
    const shoutboxHidden = await applyShoutboxThreshold(
      tx,
      input.targetType,
      input.targetId,
      locked.id,
      now
    )
    return { caseId: locked.id, created: false, subscribed, shoutboxHidden }
  }

  if (dailyKey !== null) {
    const daily = await tx.ops_case.findUnique({
      where: { daily_key: dailyKey },
      select: { id: true }
    })
    if (daily) return '您今天已经提交过该资源的问题，请明天再试'
  }

  const inserted = await tx.ops_case.createMany({
    data: [
      {
        kind: input.kind,
        target_type: input.targetType,
        target_id: input.targetId,
        patch_id: derived.patchId,
        reporter_id: input.reporterId ?? null,
        owner_type: derived.ownerType,
        owner_id: derived.ownerId,
        status: 'open',
        public: derived.public,
        source,
        dedup_key: dedupKey,
        daily_key: dailyKey,
        revision: 0,
        status_changed_at: now,
        queue_entered_at: now,
        created: now,
        updated: now
      }
    ],
    skipDuplicates: true
  })
  if (inserted.count === 0) {
    const winner = await tx.ops_case.findUnique({
      where: { dedup_key: dedupKey },
      select: { id: true, status: true }
    })
    if (winner) {
      const locked = await getCaseLock(tx, winner.id)
      if (!locked) return '问题不存在'
      if (!unresolvedStatuses.includes(locked.status as never)) {
        return {
          justClosed: true,
          caseId: locked.id,
          created: false,
          subscribed: false
        }
      }
      if (input.reporterId !== null && input.reporterId !== undefined) {
        const result = await tx.ops_case_subscriber.createMany({
          data: [{ case_id: locked.id, user_id: input.reporterId }],
          skipDuplicates: true
        })
        const shoutboxHidden = await applyShoutboxThreshold(
          tx,
          input.targetType,
          input.targetId,
          locked.id,
          now
        )
        return {
          caseId: locked.id,
          created: false,
          subscribed: result.count > 0,
          shoutboxHidden
        }
      }
      const shoutboxHidden = await applyShoutboxThreshold(
        tx,
        input.targetType,
        input.targetId,
        locked.id,
        now
      )
      return {
        caseId: locked.id,
        created: false,
        subscribed: false,
        shoutboxHidden
      }
    }
    if (dailyKey !== null) {
      const daily = await tx.ops_case.findUnique({
        where: { daily_key: dailyKey },
        select: { id: true }
      })
      if (daily) return '您今天已经提交过该资源的问题，请明天再试'
    }
    return '该问题刚刚发生变化，请刷新后重试'
  }

  const row = await tx.ops_case.findUnique({
    where: { dedup_key: dedupKey },
    select: caseSelect
  })
  if (!row) return '问题创建失败，请重试'
  const body = input.content?.trim() ?? ''
  if (body) {
    await tx.ops_case_message.create({
      data: {
        case_id: row.id,
        author_id: input.reporterId ?? null,
        kind: 'reply',
        body,
        created: now
      }
    })
  }
  // The first reporter is a subscriber too, so the badge count is stable even
  // when all later reports arrive through the dedup branch.
  if (input.reporterId !== null && input.reporterId !== undefined) {
    await tx.ops_case_subscriber.createMany({
      data: [{ case_id: row.id, user_id: input.reporterId }],
      skipDuplicates: true
    })
  }
  const ownerNotice = `有新的${CASE_KIND_LABELS[input.kind]}待处理，请前往问题处理查看。`
  if (row.owner_type === 'publisher' && row.owner_id !== null) {
    await notifyCaseUsers(tx, row.id, [row.owner_id], ownerNotice)
  } else {
    const admins = await tx.user.findMany({
      where: { role: { gte: 3 } },
      select: { id: true }
    })
    await notifyCaseUsers(
      tx,
      row.id,
      admins.map(({ id }) => id),
      ownerNotice,
      input.reporterId,
      `/dashboard/case/${row.id}`
    )
  }

  // Module 02's three-reporter threshold is a transient hide. The case stays
  // open in the staff queue; the helper only changes the shoutbox row.
  const shoutboxHidden = await applyShoutboxThreshold(
    tx,
    input.targetType,
    input.targetId,
    row.id,
    now
  )
  return { caseId: row.id, created: true, subscribed: false, shoutboxHidden }
}

export const appendCaseSystemMessage = async (
  tx: CaseTx,
  caseId: number,
  event: CaseMessageEvent,
  payload: Record<string, unknown> | null,
  body: string
) => {
  if (!(CASE_MESSAGE_EVENTS as readonly string[]).includes(event)) {
    throw new Error('Invalid case event')
  }
  return tx.ops_case_message.create({
    data: {
      case_id: caseId,
      author_id: null,
      kind: 'system',
      event,
      payload: asInputJson(payload),
      body: body.slice(0, 5007)
    },
    select: messageSelect
  })
}

type CloseCaseInput = {
  caseId: number
  expectedStatuses: readonly CaseStatus[]
  resolution: CaseResolution
  actorType: CaseActorType
  actorId?: number | null
  event?: CaseMessageEvent
  body?: string
  payload?: Record<string, unknown> | null
  status?: Extract<CaseStatus, 'resolved' | 'rejected'>
  now?: Date
  additionalData?: Prisma.ops_caseUpdateInput
}

/**
 * The only terminal transition. It owns the CAS, structured event, dedup key
 * cleanup and one notification per recipient inside the caller's transaction.
 */
export const closeCaseInternal = async (tx: CaseTx, input: CloseCaseInput) => {
  const now = input.now ?? new Date()
  const row = await getCaseLock(tx, input.caseId)
  if (!row) return { changed: false as const, reason: '问题不存在' }
  if (!input.expectedStatuses.includes(row.status as CaseStatus)) {
    return { changed: false as const, reason: '该问题已被他人处理' }
  }
  if (!isCaseResolution(input.resolution)) {
    return { changed: false as const, reason: '结论不合法' }
  }
  const toStatus = input.status ?? 'resolved'
  const updated = await tx.ops_case.updateMany({
    where: {
      id: row.id,
      status: { in: [...input.expectedStatuses] },
      revision: row.revision
    },
    data: {
      status: toStatus,
      resolution: input.resolution,
      status_changed_at: now,
      closed_at: now,
      dedup_key: null,
      revision: { increment: 1 },
      updated: now,
      ...input.additionalData
    }
  })
  if (updated.count === 0)
    return { changed: false as const, reason: '该问题已被他人处理' }
  const event = input.event ?? 'resolved'
  const payload: Record<string, unknown> = {
    ...(input.payload ?? {}),
    resolution: input.resolution,
    closed_at: now.toISOString(),
    actor_type: input.actorType,
    from_status: row.status,
    to_status: toStatus,
    from_state_entered_at: row.status_changed_at.toISOString(),
    queue_entered_at: row.queue_entered_at.toISOString(),
    first_owner_response_at: iso(row.first_owner_response_at)
  }
  await appendCaseSystemMessage(
    tx,
    row.id,
    event,
    payload,
    input.body ?? `问题已结案：${CASE_RESOLUTION_LABELS[input.resolution]}`
  )
  await notifyCaseParticipants(
    tx,
    row,
    `您的问题处理已有结果：${CASE_RESOLUTION_LABELS[input.resolution]}。`,
    input.actorId
  )
  return { changed: true as const, row, resolution: input.resolution }
}

const fetchCaseForViewer = async (
  db: CaseDb,
  id: number,
  viewerId: number,
  viewerRole: number
): Promise<CaseDetailResponse | string> => {
  const row = await getCaseById(db, id)
  if (!row) return '问题不存在'
  const subscription = await db.ops_case_subscriber.findUnique({
    where: { case_id_user_id: { case_id: id, user_id: viewerId } },
    select: { user_id: true }
  })
  const target = await loadTarget(db, row)
  const view = canViewCase(
    row,
    viewerId,
    viewerRole,
    Boolean(subscription),
    target.resource?.user_id
  )
  if (!view) return '无权查看该问题'
  const options = listViewOptions(
    row,
    viewerId,
    viewerRole,
    Boolean(subscription),
    target.resource?.user_id
  )!
  const summary = toSummary(row, target, options)
  const messagesRows =
    view === 'subscriber-public' || view === 'subscriber-private'
      ? []
      : await db.ops_case_message.findMany({
          where: { case_id: id },
          orderBy: [{ created: 'asc' }, { id: 'asc' }],
          select: messageSelect
        })
  const detail: CaseDetail = {
    ...summary,
    messages: messagesRows.map((message) =>
      serializeMessage(message, {
        identifyReporter: options.identifyReporter,
        reporterId: row.reporter_id,
        includePayload: view === 'admin'
      })
    ),
    ...(view === 'subscriber-private'
      ? {
          viewerSubscription: {
            subscribed: true,
            submitted: row.reporter_id === viewerId
          }
        }
      : {}),
    capabilities: capabilitiesFor(row, viewerId, viewerRole, target)
  }
  return { case: detail }
}

export const getCase = (
  caseId: number,
  viewerId: number,
  viewerRole: number,
  options: { db?: PrismaClient } = {}
) => fetchCaseForViewer(options.db ?? prisma, caseId, viewerId, viewerRole)

export const createCase = async (
  input: CreateCaseInput,
  reporterId: number,
  options: { now?: Date; db?: PrismaClient } = {}
): Promise<CaseCreateResponse | string> => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const result = await db.$transaction(async (tx) =>
    openCaseInternal(tx, {
      kind: input.kind,
      targetType: input.targetType,
      targetId: input.targetId,
      expectedPatchId: input.expectedPatchId,
      reporterId,
      content: input.content,
      source: 'user',
      now
    })
  )
  if (typeof result === 'string') return result
  if (result.justClosed) {
    return {
      case: { id: result.caseId } as CaseSummary,
      created: false,
      subscribed: false,
      justClosed: true
    }
  }
  const row = await getCaseById(db, result.caseId)
  if (!row) return '问题不存在'
  if (result.created || result.subscribed) {
    await invalidateCasePatchCaches(db, [row.patch_id])
  }
  if (result.shoutboxHidden) {
    await invalidateCaseShoutboxCaches()
  }
  const serialized = await serializeSummaryForViewer(
    db,
    row,
    reporterId,
    1,
    true
  )
  if (!serialized) return '问题创建失败，请重试'
  return {
    case: serialized.summary,
    created: result.created,
    subscribed: result.subscribed
  }
}

/**
 * Turn one `groupBy({ by: ['status'] })` result into a dense record. Every
 * `CaseStatus` key is present so the tab strip can index it directly, including
 * statuses this module never writes.
 */
const toStatusCounts = (
  groups: readonly { status: string; _count: { _all: number } }[]
): CaseStatusCounts => {
  const counts = Object.fromEntries(
    CASE_STATUSES.map((status) => [status, 0])
  ) as CaseStatusCounts
  for (const group of groups) {
    if (isCaseStatus(group.status)) counts[group.status] += group._count._all
  }
  return counts
}

const getTabWhere = (tab: CaseTab, uid: number): Prisma.ops_caseWhereInput => {
  if (tab === 'owned') {
    return { owner_type: 'publisher', owner_id: uid }
  }
  if (tab === 'subscribed') {
    return { subscribers: { some: { user_id: uid } } }
  }
  return { reporter_id: uid }
}

export const listCases = async (
  input: CaseListInput,
  viewerId: number,
  viewerRole: number,
  options: { db?: PrismaClient } = {}
): Promise<CaseListResponse | string> => {
  const db = options.db ?? prisma
  // The tab predicate alone is the counting scope: folding either status filter
  // in would make every tab count equal its own filter. `total` adds the status
  // filter on top of the same scope, so both come from one set of predicates.
  // Neither number subtracts the per-row visibility trimming below, which can
  // drop rows the count already included; that skew is pre-existing behaviour.
  const scopeWhere = getTabWhere(input.tab, viewerId)
  // `statuses` wins over the single `status` when both arrive. It is the form
  // that expresses a merged tab (处理中 = open + waiting_owner), so a leftover
  // `status` from an older client must not narrow it back down.
  const statusWhere: Prisma.ops_caseWhereInput = input.statuses?.length
    ? { status: { in: input.statuses } }
    : input.status
      ? { status: input.status }
      : {}
  const where: Prisma.ops_caseWhereInput = { ...scopeWhere, ...statusWhere }
  const [rows, total, statusGroups] = await Promise.all([
    db.ops_case.findMany({
      where,
      orderBy: [{ status_changed_at: 'desc' }, { id: 'desc' }],
      skip: (input.page - 1) * input.limit,
      take: input.limit,
      select: caseListSelect
    }),
    db.ops_case.count({ where }),
    db.ops_case.groupBy({
      by: ['status'],
      where: scopeWhere,
      _count: { _all: true }
    })
  ])
  const caseIds = rows.map((row) => row.id)
  const [targetByCaseId, subscribedRows] = await Promise.all([
    loadTargets(db, rows),
    queryManyIfNeeded(caseIds, () =>
      db.ops_case_subscriber.findMany({
        where: { case_id: { in: caseIds }, user_id: viewerId },
        select: { case_id: true }
      })
    )
  ])
  const subscribedCaseIds = new Set(subscribedRows.map((row) => row.case_id))
  const cases: CaseListItem[] = []
  for (const row of rows) {
    const subscribed = subscribedCaseIds.has(row.id)
    const serialized = await serializeSummaryForViewer(
      db,
      row,
      viewerId,
      viewerRole,
      subscribed,
      targetByCaseId.get(row.id)
    )
    if (!serialized) continue
    const latestMessage = row.messages?.[0]
    cases.push({
      ...serialized.summary,
      ...(serialized.view !== 'subscriber-public' &&
      serialized.view !== 'subscriber-private'
        ? {
            latestMessage: latestMessage
              ? toMessagePreview(latestMessage)
              : null
          }
        : {}),
      ...capabilitiesFor(row, viewerId, viewerRole, serialized.target)
    })
  }
  return {
    tab: input.tab,
    cases,
    total,
    statusCounts: toStatusCounts(statusGroups),
    page: input.page,
    limit: input.limit
  }
}

const actorCanReply = (row: CaseRow, uid: number, role: number) =>
  role >= 3 ||
  row.reporter_id === uid ||
  (row.owner_type === 'publisher' && row.owner_id === uid)

export const appendCaseMessage = async (
  input: AppendCaseInput,
  uid: number,
  role: number,
  options: { now?: Date; db?: PrismaClient } = {}
): Promise<CaseMessageResponse | string> => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const result = await db.$transaction(async (tx) => {
    const row = await getCaseLock(tx, input.caseId)
    if (!row) return '问题不存在'
    if (!unresolvedStatuses.includes(row.status as never)) return '该问题已结案'
    if (!actorCanReply(row, uid, role)) return '无权回复该问题'
    const isReporter = row.reporter_id === uid && role < 3
    const isOwner =
      row.owner_type === 'publisher' && row.owner_id === uid && role < 3
    const isProcessingParty = role >= 3 || isOwner
    const nextStatus: CaseStatus =
      isReporter && row.status === 'waiting_reporter'
        ? 'waiting_owner'
        : isProcessingParty &&
            row.reporter_id !== null &&
            (row.status === 'open' || row.status === 'waiting_owner')
          ? 'waiting_reporter'
          : (row.status as CaseStatus)
    const stateChanged = nextStatus !== row.status
    const firstOwnerResponse =
      !isReporter && row.first_owner_response_at === null ? now : null
    const updated = await tx.ops_case.updateMany({
      where: { id: row.id, status: row.status, revision: row.revision },
      data: {
        ...(stateChanged
          ? {
              status: nextStatus,
              status_changed_at: now,
              revision: { increment: 1 }
            }
          : {}),
        ...(firstOwnerResponse
          ? { first_owner_response_at: firstOwnerResponse }
          : {}),
        updated: now
      }
    })
    if (updated.count === 0) return '该问题刚刚被他人更新，请刷新后重试'
    const message = await tx.ops_case_message.create({
      data: {
        case_id: row.id,
        author_id: uid,
        kind: 'reply',
        body: input.content,
        created: now
      },
      select: messageSelect
    })
    const recipients: number[] = []
    if (isReporter) {
      if (row.owner_type === 'publisher' && row.owner_id !== null)
        recipients.push(row.owner_id)
      if (row.owner_type === 'staff') {
        const admins = await tx.user.findMany({
          where: { role: { gte: 3 } },
          select: { id: true }
        })
        recipients.push(...admins.map(({ id }) => id))
      }
    } else if (row.reporter_id !== null) {
      recipients.push(row.reporter_id)
    }
    await notifyCaseUsers(
      tx,
      row.id,
      recipients,
      '问题处理有新的回复，请前往问题处理查看。',
      isReporter ? null : uid,
      row.owner_type === 'staff' && isReporter
        ? `/dashboard/case/${row.id}`
        : caseLink(row.id)
    )
    return { row, message }
  })
  if (typeof result === 'string') return result
  const row = await getCaseById(db, input.caseId)
  if (!row) return '问题不存在'
  const serialized = await serializeSummaryForViewer(db, row, uid, role, true)
  if (!serialized) return '问题不存在'
  return {
    case: serialized.summary,
    message: serializeMessage(result.message, {
      identifyReporter: role >= 3 || result.row.reporter_id === uid,
      reporterId: result.row.reporter_id,
      includePayload: role >= 3
    })
  }
}

const assertResolution = (kind: string, resolution: string) => {
  if (!isCaseKind(kind) || !isCaseResolution(resolution)) return false
  return CASE_RESOLUTIONS_BY_KIND[kind].includes(resolution)
}

export const resolveCase = async (
  input: ResolveCaseInput,
  uid: number,
  options: { now?: Date; db?: PrismaClient } = {}
): Promise<CaseActionResponse | string> => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const result = await db.$transaction(async (tx) => {
    const row = await getCaseLock(tx, input.caseId)
    if (!row) return '问题不存在'
    if (!assertResolution(row.kind, input.resolution))
      return '当前问题不支持该结论'
    if (row.owner_type !== 'publisher' || row.owner_id !== uid)
      return '只有当前资源发布者可以结案'
    if (row.kind !== 'resource_mismatch') return '当前问题不能由发布者结案'
    if (
      !(
        ['repaired', 'unreproducible', 'out_of_scope'] as CaseResolution[]
      ).includes(input.resolution)
    ) {
      return '发布者不能使用该结论'
    }
    return closeCaseInternal(tx, {
      caseId: row.id,
      expectedStatuses: unresolvedStatuses as CaseStatus[],
      resolution: input.resolution,
      actorType: 'publisher',
      actorId: uid,
      body: input.content || undefined,
      now
    })
  })
  if (typeof result === 'string') return result
  if (!result.changed) return result.reason
  const row = await getCaseById(db, input.caseId)
  if (!row) return '问题不存在'
  await invalidateCasePatchCaches(db, [row.patch_id])
  const serialized = await serializeSummaryForViewer(db, row, uid, 2, true)
  if (!serialized) return '问题不存在'
  return { case: serialized.summary, changed: true }
}

const notifyReopen = async (tx: CaseTx, row: CaseRow) => {
  if (row.owner_type === 'publisher' && row.owner_id !== null) {
    await notifyCaseUsers(
      tx,
      row.id,
      [row.owner_id],
      '您负责的问题已被开启者重新提交，请前往问题处理查看。'
    )
  } else {
    const admins = await tx.user.findMany({
      where: { role: { gte: 3 } },
      select: { id: true }
    })
    await notifyCaseUsers(
      tx,
      row.id,
      admins.map(({ id }) => id),
      '问题已重新提交，请前往后台问题处理查看。',
      null,
      `/dashboard/case/${row.id}`
    )
  }
}

export const reopenCase = async (
  caseId: number,
  uid: number,
  options: { now?: Date; db?: PrismaClient } = {}
): Promise<CaseReopenResponse | string> => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  let conflictKey: string | null = null
  let result:
    | { changed: boolean; reason?: string }
    | CaseReopenResponse
    | string = ''
  try {
    result = await db.$transaction(async (tx) => {
      const row = await getCaseLock(tx, caseId)
      if (!row) return '问题不存在'
      if (row.reporter_id !== uid) return '只有开启者可以重新提交'
      if (!closedStatuses.includes(row.status as never))
        return '当前问题尚未结案'
      if (row.reopened_count > 0) return '每个问题只能重开一次'
      if (
        !row.closed_at ||
        row.closed_at.getTime() < now.getTime() - CASE_REOPEN_WINDOW_MS
      ) {
        return '该问题已超过 7 天，不能重开'
      }
      const dedupKey = buildCaseDedupKey(
        row.target_type as CaseTargetType,
        row.target_id,
        row.kind as CaseKind
      )
      conflictKey = dedupKey
      const collision = await tx.ops_case.findUnique({
        where: { dedup_key: dedupKey },
        select: { id: true }
      })
      if (collision && collision.id !== row.id) {
        return { conflict: true as const, existingCaseId: collision.id }
      }
      const previous = {
        resolution: row.resolution,
        closed_at: iso(row.closed_at),
        first_owner_response_at: iso(row.first_owner_response_at)
      }
      const updated = await tx.ops_case.updateMany({
        where: {
          id: row.id,
          status: row.status,
          revision: row.revision,
          reopened_count: 0
        },
        data: {
          status: 'open',
          dedup_key: dedupKey,
          status_changed_at: now,
          queue_entered_at: now,
          first_owner_response_at: null,
          reopened_count: { increment: 1 },
          revision: { increment: 1 },
          updated: now
        }
      })
      if (updated.count === 0) return '该问题刚刚被他人处理，请刷新后重试'
      await appendCaseSystemMessage(
        tx,
        row.id,
        'reopened',
        {
          ...previous,
          from_status: row.status,
          to_status: 'open',
          from_state_entered_at: row.status_changed_at.toISOString(),
          queue_entered_at: now.toISOString()
        },
        '问题已重新提交，处理方会继续跟进。'
      )
      await notifyReopen(tx, row)
      return { changed: true }
    })
  } catch (error) {
    const code = getUniqueConstraintCode(error)
    if (code === 'P2002' || code === '23505') {
      const existing = conflictKey
        ? await db.ops_case.findUnique({
            where: { dedup_key: conflictKey },
            select: { id: true }
          })
        : null
      if (existing && existing.id !== caseId) {
        return { conflict: true, existingCaseId: existing.id }
      }
      return '该目标已有正在处理的问题'
    }
    throw error
  }
  if (typeof result === 'string') return result
  if ('conflict' in result) return result
  if (!result.changed)
    return result.reason ?? '该问题刚刚被他人处理，请刷新后重试'
  const row = await getCaseById(db, caseId)
  if (!row) return '问题不存在'
  await invalidateCasePatchCaches(db, [row.patch_id])
  const serialized = await serializeSummaryForViewer(db, row, uid, 1, true)
  if (!serialized) return '问题不存在'
  return { case: serialized.summary, changed: true }
}

export const handleCaseAsAdmin = async (
  input: AdminHandleInput,
  adminId: number,
  adminRole: number,
  options: { now?: Date; db?: PrismaClient } = {}
): Promise<CaseActionResponse | CaseMessageResponse | string> => {
  const db = options.db ?? prisma
  if (adminRole < 3) return '本页面仅管理员可访问'
  if (input.action === 'reply') {
    if (!input.content.trim()) return '回复内容不能为空'
    return appendCaseMessage(
      { caseId: input.caseId, content: input.content },
      adminId,
      adminRole,
      options
    )
  }
  const now = options.now ?? new Date()
  const result = await db.$transaction(async (tx) => {
    const row = await getCaseLock(tx, input.caseId)
    if (!row) return '问题不存在'
    let resolution = input.resolution
    if (input.action === 'reject' && resolution === undefined) {
      resolution =
        row.kind === 'resource_mismatch' ? 'out_of_scope' : 'not_established'
    }
    if (!resolution || !assertResolution(row.kind, resolution))
      return '当前问题不支持该结论'
    if (resolution === 'not_established' && !input.content.trim()) {
      return '登记不成立必须填写处理说明'
    }
    if (resolution === 'reporter_unresponsive') {
      return '开启者未回应只能由超时任务登记'
    }
    if (
      row.kind === 'resource_mismatch' &&
      row.owner_type === 'staff' &&
      row.escalated_at !== null &&
      resolution !== 'escalated_ignored'
    ) {
      return '已升级的资源问题只能隐藏或忽略'
    }
    if (
      row.kind === 'content_violation' &&
      row.target_type === 'shoutbox' &&
      resolution === 'not_established'
    ) {
      const shoutbox = await tx.shoutbox.findUnique({
        where: { id: row.target_id },
        select: { status: true }
      })
      if (shoutbox?.status === 2) {
        return '隐藏中的小喇叭必须删除或恢复'
      }
    }
    if (
      ['moved', 'escalated_hidden', 'violation_hidden', 'handled'].includes(
        resolution
      )
    ) {
      if (
        !(
          row.kind === 'other' &&
          row.target_type === 'patch' &&
          resolution === 'handled'
        )
      ) {
        if (
          !(
            row.kind === 'content_violation' &&
            row.target_type === 'user' &&
            resolution === 'handled'
          )
        ) {
          return '该结论必须通过对应的处置动作完成'
        }
      }
    }
    if (
      resolution === 'escalated_ignored' &&
      !(
        row.kind === 'resource_mismatch' &&
        row.owner_type === 'staff' &&
        row.escalated_at !== null
      )
    ) {
      return '该结论只能用于已升级的资源问题'
    }
    if (
      input.action === 'reject' &&
      !(['not_established', 'out_of_scope'] as CaseResolution[]).includes(
        resolution
      )
    ) {
      return '驳回只能使用不成立或不在受理范围结论'
    }
    if (
      row.kind === 'content_violation' &&
      row.target_type === 'user' &&
      resolution === 'handled'
    ) {
      if (adminRole < 4)
        return '用户举报必须由超级管理员在既有用户管理入口完成处置后登记'
      if (!input.handledUserConfirmed || !input.content.trim()) {
        return '请先在既有用户管理入口完成处置，确认后填写处理说明'
      }
    }
    const targetStatus = input.action === 'reject' ? 'rejected' : 'resolved'
    return closeCaseInternal(tx, {
      caseId: row.id,
      expectedStatuses: unresolvedStatuses as CaseStatus[],
      resolution,
      actorType: 'staff',
      actorId: adminId,
      body: input.content || undefined,
      status: targetStatus,
      now
    })
  })
  if (typeof result === 'string') return result
  if (!result.changed) return result.reason
  const row = await getCaseById(db, input.caseId)
  if (!row) return '问题不存在'
  await invalidateCasePatchCaches(db, [row.patch_id])
  const serialized = await serializeSummaryForViewer(
    db,
    row,
    adminId,
    adminRole,
    true
  )
  if (!serialized) return '问题不存在'
  return { case: serialized.summary, changed: true }
}

const resourceCaseRow = async (tx: CaseTx, caseId: number) =>
  tx.ops_case.findUnique({
    where: { id: caseId },
    select: caseSelect
  })

export const handleCaseResource = async (
  input: AdminResourceInput,
  adminId: number,
  adminRole: number,
  options: { now?: Date; db?: PrismaClient } = {}
): Promise<CaseResourceActionResponse | string> => {
  const db = options.db ?? prisma
  if (adminRole < 3) return '本页面仅管理员可访问'
  const now = options.now ?? new Date()
  const result = await runCaseOperation(db, async (tx) => {
    const initial = await resourceCaseRow(tx, input.caseId)
    if (!initial) return '问题不存在'
    if (initial.target_type !== 'resource') return '该问题目标不是资源'
    const resource = await lockResource(tx, initial.target_id)
    if (!resource) return '资源不存在'
    if (input.action === 'hide') {
      if (
        !unresolvedStatuses.includes(initial.status as never) ||
        !(
          (initial.kind === 'resource_mismatch' &&
            initial.owner_type === 'staff' &&
            initial.escalated_at !== null) ||
          (initial.kind === 'content_violation' &&
            initial.target_type === 'resource')
        )
      )
        return '当前问题不能隐藏资源'
      if (resource.status !== 0) return '当前资源不能隐藏'
      const resourceUpdated = await tx.patch_resource.updateMany({
        where: { id: resource.id, status: 0 },
        data: { status: 1, updated: now }
      })
      if (resourceUpdated.count !== 1)
        rollbackCaseOperation('该资源刚刚被他人处理，请刷新后重试')
      const uniqueId = await updatePatchAttributes(resource.patch_id, tx)
      await tx.admin_log.create({
        data: {
          type: 'case_resource_hide',
          user_id: adminId,
          content: `管理员通过问题 #${initial.id} 隐藏资源 #${resource.id}`
        }
      })
      const resolution: CaseResolution =
        initial.kind === 'content_violation'
          ? 'violation_hidden'
          : 'escalated_hidden'
      const closed = await closeCaseInternal(tx, {
        caseId: initial.id,
        expectedStatuses: unresolvedStatuses as CaseStatus[],
        resolution,
        actorType: 'staff',
        actorId: adminId,
        event: 'hidden',
        payload: {
          resource_id: resource.id,
          previous_resource_status: resource.status
        },
        additionalData: { hidden_at: now },
        now
      })
      if (!closed.changed) rollbackCaseOperation(closed.reason)
      return { action: 'hide' as const, patchId: resource.patch_id, uniqueId }
    }
    if (input.action === 'restore') {
      if (
        !closedStatuses.includes(initial.status as never) ||
        !['escalated_hidden', 'violation_hidden'].includes(
          initial.resolution ?? ''
        ) ||
        initial.hidden_at === null ||
        initial.restored_at !== null
      )
        return '该隐藏不是此问题造成或已经恢复过'
      if (resource.status !== 1) return '当前资源不能恢复'
      const resourceUpdated = await tx.patch_resource.updateMany({
        where: { id: resource.id, status: 1 },
        data: { status: 0, updated: now }
      })
      if (resourceUpdated.count !== 1)
        rollbackCaseOperation('该资源刚刚被他人处理，请刷新后重试')
      const uniqueId = await updatePatchAttributes(resource.patch_id, tx)
      const updated = await tx.ops_case.updateMany({
        where: {
          id: initial.id,
          status: initial.status,
          hidden_at: { not: null },
          restored_at: null
        },
        data: { restored_at: now, updated: now }
      })
      if (updated.count === 0)
        rollbackCaseOperation('该问题刚刚被他人处理，请刷新后重试')
      await appendCaseSystemMessage(
        tx,
        initial.id,
        'restored',
        {
          resource_id: resource.id,
          previous_resource_status: resource.status,
          from_status: initial.status,
          to_status: initial.status
        },
        '资源已恢复公开显示。'
      )
      if (resource.user_id) {
        await notifyCaseUsers(
          tx,
          initial.id,
          [resource.user_id],
          '该资源已恢复公开显示。',
          adminId,
          initial.public ? caseLink(initial.id) : `/${uniqueId}`
        )
      }
      await tx.admin_log.create({
        data: {
          type: 'case_resource_restore',
          user_id: adminId,
          content: `管理员通过问题 #${initial.id} 恢复资源 #${resource.id}`
        }
      })
      return {
        action: 'restore' as const,
        patchId: resource.patch_id,
        uniqueId
      }
    }
    if (
      initial.kind !== 'resource_wrong_patch' ||
      !unresolvedStatuses.includes(initial.status as never)
    ) {
      return '当前问题不能移动资源'
    }
    const targetPatchId = input.targetPatchId
    if (!targetPatchId) return '移动资源必须提供目标条目'
    if (targetPatchId === resource.patch_id) return '目标条目必须与当前条目不同'
    const targetPatch = await tx.patch.findUnique({
      where: { id: targetPatchId },
      select: { id: true, unique_id: true, status: true }
    })
    if (!targetPatch || targetPatch.status !== 0)
      return '目标条目不存在或不可用'
    const fromPatchId = resource.patch_id
    const resourceUpdated = await tx.patch_resource.updateMany({
      where: { id: resource.id, patch_id: fromPatchId },
      data: { patch_id: targetPatchId, updated: now }
    })
    if (resourceUpdated.count !== 1)
      rollbackCaseOperation('该资源刚刚被他人处理，请刷新后重试')
    await tx.patch_resource_access.updateMany({
      where: { resource_id: resource.id },
      data: { patch_id: targetPatchId, updated: now }
    })
    const linkedCasesUpdated = await tx.ops_case.updateMany({
      where: { target_type: 'resource', target_id: resource.id },
      data: { patch_id: targetPatchId, updated: now }
    })
    if (linkedCasesUpdated.count === 0)
      rollbackCaseOperation('该资源刚刚被他人处理，请刷新后重试')
    const [fromUniqueId, toUniqueId] = await Promise.all([
      updatePatchAttributes(fromPatchId, tx),
      updatePatchAttributes(targetPatchId, tx)
    ])
    await tx.admin_log.create({
      data: {
        type: 'case_resource_move',
        user_id: adminId,
        content: `管理员通过问题 #${initial.id} 移动资源 #${resource.id}（${fromPatchId} -> ${targetPatchId}）`
      }
    })
    const closed = await closeCaseInternal(tx, {
      caseId: initial.id,
      expectedStatuses: unresolvedStatuses as CaseStatus[],
      resolution: 'moved',
      actorType: 'staff',
      actorId: adminId,
      event: 'moved',
      payload: {
        resource_id: resource.id,
        from_patch_id: fromPatchId,
        to_patch_id: targetPatchId
      },
      now
    })
    if (!closed.changed) rollbackCaseOperation(closed.reason)
    return {
      action: 'move' as const,
      fromPatchId,
      toPatchId: targetPatchId,
      uniqueId: `${fromUniqueId}:${toUniqueId}`
    }
  })
  if (typeof result === 'string') return result
  const row = await getCaseById(db, input.caseId)
  if (!row) return '问题不存在'
  await invalidateCasePatchCaches(
    db,
    result.action === 'move'
      ? [result.fromPatchId, result.toPatchId]
      : [result.patchId],
    true
  )
  const serialized = await serializeSummaryForViewer(
    db,
    row,
    adminId,
    adminRole,
    true
  )
  if (!serialized) return '问题不存在'
  return {
    case: serialized.summary,
    changed: true,
    action: result.action,
    ...(result.action === 'move'
      ? { fromPatchId: result.fromPatchId, toPatchId: result.toPatchId }
      : {})
  }
}

export const handleCaseContent = async (
  input: AdminContentInput,
  adminId: number,
  adminRole: number,
  options: { now?: Date; db?: PrismaClient } = {}
): Promise<CaseContentActionResponse | string> => {
  const db = options.db ?? prisma
  if (adminRole < 3) return '本页面仅管理员可访问'
  const now = options.now ?? new Date()
  const result = await runCaseOperation(db, async (tx) => {
    const row = await getCaseLock(tx, input.caseId)
    if (!row) return '问题不存在'
    if (
      row.kind !== 'content_violation' ||
      !unresolvedStatuses.includes(row.status as never)
    ) {
      return '当前问题不能执行内容处置'
    }
    if (row.target_type === 'user') {
      return '用户举报请先在既有用户管理入口完成处置，再登记结论'
    }
    const targetMissing =
      (row.target_type === 'comment' &&
        !(await tx.patch_comment.findUnique({
          where: { id: row.target_id },
          select: { id: true }
        }))) ||
      (row.target_type === 'rating' &&
        !(await tx.patch_rating.findUnique({
          where: { id: row.target_id },
          select: { id: true }
        }))) ||
      (row.target_type === 'shoutbox' &&
        !(await tx.shoutbox.findUnique({
          where: { id: row.target_id },
          select: { id: true }
        })))
    if (targetMissing) {
      const closed = await closeCaseInternal(tx, {
        caseId: row.id,
        expectedStatuses: unresolvedStatuses as CaseStatus[],
        resolution: input.action === 'restore' ? 'not_established' : 'handled',
        actorType: 'staff',
        actorId: adminId,
        payload: { handled_target: 'missing' },
        body: input.content || '目标已不存在，事项已登记处理。',
        now
      })
      if (!closed.changed) return closed.reason
      return { targetMissing: true, action: input.action }
    }
    let patchId: number | null = row.patch_id
    if (input.action === 'delete') {
      const { deleteReportedTargetInTransaction } = await import(
        '~/app/api/admin/report/service'
      )
      if (row.target_type === 'comment') {
        const comment = await tx.patch_comment.findUnique({
          where: { id: row.target_id },
          select: { id: true, patch_id: true }
        })
        if (comment) {
          patchId = comment.patch_id
          const deleted = await deleteReportedTargetInTransaction(tx, {
            targetType: 'comment',
            targetId: comment.id,
            patchId: comment.patch_id
          })
          if (!deleted)
            rollbackCaseOperation('评论刚刚被他人处理，请刷新后重试')
        }
      } else if (row.target_type === 'rating') {
        const rating = await tx.patch_rating.findUnique({
          where: { id: row.target_id },
          select: { id: true, patch_id: true }
        })
        if (rating) {
          patchId = rating.patch_id
          const deleted = await deleteReportedTargetInTransaction(tx, {
            targetType: 'rating',
            targetId: rating.id,
            patchId: rating.patch_id
          })
          if (!deleted)
            rollbackCaseOperation('评价刚刚被他人处理，请刷新后重试')
        }
      } else {
        return '评论和评价使用 delete，小喇叭请使用 takedown 或 restore'
      }
    } else if (row.target_type === 'shoutbox') {
      const { removeShoutboxForCase, restoreShoutboxForCase } = await import(
        '~/app/api/shoutbox/service'
      )
      if (input.action === 'takedown') {
        const removed = await removeShoutboxForCase(
          tx,
          row.target_id,
          adminId,
          now
        )
        if (typeof removed === 'string') return removed
      } else if (input.action === 'restore') {
        const restored = await restoreShoutboxForCase(
          tx,
          row.target_id,
          adminId,
          now
        )
        if (typeof restored === 'string') return restored
      }
    } else {
      return '小喇叭请使用 takedown 或 restore'
    }
    const resolution: CaseResolution =
      input.action === 'restore' ? 'not_established' : 'handled'
    const closed = await closeCaseInternal(tx, {
      caseId: row.id,
      expectedStatuses: unresolvedStatuses as CaseStatus[],
      resolution,
      actorType: 'staff',
      actorId: adminId,
      payload: { handled_target: row.target_type },
      body: input.content || undefined,
      now
    })
    if (!closed.changed) rollbackCaseOperation(closed.reason)
    return { targetMissing: false, action: input.action, patchId }
  })
  if (typeof result === 'string') return result
  const row = await getCaseById(db, input.caseId)
  if (!row) return '问题不存在'
  await invalidateCasePatchCaches(db, [row.patch_id])
  if (row.target_type === 'shoutbox') {
    await invalidateCaseShoutboxCaches()
  }
  const serialized = await serializeSummaryForViewer(
    db,
    row,
    adminId,
    adminRole,
    true
  )
  if (!serialized) return '问题不存在'
  return {
    case: serialized.summary,
    changed: true,
    action: result.action,
    targetMissing: result.targetMissing
  }
}

export const getAdminCases = async (
  input: AdminListInput,
  options: { db?: PrismaClient; now?: Date } = {}
): Promise<AdminCaseListResponse> => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const contains = { contains: input.search, mode: 'insensitive' as const }
  const numericSearch = Number(input.search)
  const searchPredicates: Prisma.ops_caseWhereInput[] = [
    { kind: contains },
    { messages: { some: { body: contains } } }
  ]
  if (
    input.search &&
    Number.isSafeInteger(numericSearch) &&
    numericSearch > 0
  ) {
    searchPredicates.unshift({ id: numericSearch })
  }
  // Counting scope is the queue minus every status predicate — `statuses`,
  // `status` and `allStatuses` all stay out of it. Any of them would pin each
  // tab's count to that tab's own filter, and the default `unresolvedStatuses`
  // window would additionally hide the closed tabs the strip has to render.
  // `total` keeps the status predicate, so it stays the count of the rows this
  // response pages through.
  const scopeWhere: Prisma.ops_caseWhereInput = {
    owner_type: 'staff',
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.search ? { OR: searchPredicates } : {})
  }
  // Status ladder, most specific rung first: an explicit list beats a single
  // status, and `allStatuses` only opens the queue when neither was given —
  // a concrete selection must never be widened by a leftover flag. The last
  // rung is the inbox default and stays as it was.
  const statusWhere: Prisma.ops_caseWhereInput = input.statuses?.length
    ? { status: { in: input.statuses } }
    : input.status
      ? { status: input.status }
      : input.allStatuses
        ? {}
        : { status: { in: unresolvedStatuses } }
  const where: Prisma.ops_caseWhereInput = { ...scopeWhere, ...statusWhere }
  const [rows, total, statusGroups] = await Promise.all([
    db.ops_case.findMany({
      where,
      orderBy: [{ status_changed_at: 'asc' }, { id: 'asc' }],
      skip: (input.page - 1) * input.limit,
      take: input.limit,
      select: caseListSelect
    }),
    db.ops_case.count({ where }),
    db.ops_case.groupBy({
      by: ['status'],
      where: scopeWhere,
      _count: { _all: true }
    })
  ])
  const targetByCaseId = await loadTargets(db, rows)
  const cases: AdminCaseListItem[] = []
  for (const row of rows) {
    const target = targetByCaseId.get(row.id) ?? { targetExists: false }
    const latestMessage = row.messages?.[0]
    cases.push({
      ...toSummary(row, target, {
        identifyReporter: true,
        includeCount: true,
        includeOwner: true,
        includeReporter: true
      }),
      latestMessage: latestMessage ? toMessagePreview(latestMessage) : null
    })
  }
  return {
    cases,
    total,
    statusCounts: toStatusCounts(statusGroups),
    page: input.page,
    limit: input.limit,
    now: now.toISOString()
  }
}

export const getAdminCaseDetail = async (
  caseId: number,
  adminId = 0,
  adminRole = 3,
  options: { db?: PrismaClient } = {}
) => fetchCaseForViewer(options.db ?? prisma, caseId, adminId, adminRole)

export const upgradeCase = async (
  caseId: number,
  options: { now?: Date; db?: PrismaClient } = {}
) => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const result = await db.$transaction(async (tx) => {
    const row = await getCaseLock(tx, caseId)
    if (!row) return { changed: false as const, reason: '问题不存在' }
    if (
      row.owner_type !== 'publisher' ||
      !CASE_PUBLISHER_TIMEOUT_KINDS.includes(row.kind as never) ||
      !['open', 'waiting_owner'].includes(row.status) ||
      row.status_changed_at.getTime() >=
        now.getTime() - CASE_PUBLISHER_ESCALATION_AFTER_MS
    )
      return { changed: false as const }
    const updated = await tx.ops_case.updateMany({
      where: {
        id: row.id,
        owner_type: 'publisher',
        status: row.status,
        revision: row.revision
      },
      data: {
        owner_type: 'staff',
        owner_id: null,
        status: 'open',
        status_changed_at: now,
        queue_entered_at: now,
        escalated_at: now,
        revision: { increment: 1 },
        updated: now
      }
    })
    if (updated.count === 0) return { changed: false as const }
    await appendCaseSystemMessage(
      tx,
      row.id,
      'escalated',
      {
        from_status: row.status,
        to_status: 'open',
        from_state_entered_at: row.status_changed_at.toISOString(),
        queue_entered_at: now.toISOString(),
        from_owner_type: row.owner_type,
        from_owner_id: row.owner_id
      },
      '发布者处理超时，问题已升级至站方。'
    )
    await notifyCaseUsers(
      tx,
      row.id,
      [row.owner_id ?? 0, row.reporter_id ?? 0],
      '问题已升级至站方处理。'
    )
    const admins = await tx.user.findMany({
      where: { role: { gte: 3 } },
      select: { id: true }
    })
    await notifyCaseUsers(
      tx,
      row.id,
      admins.map(({ id }) => id),
      '问题已升级至站方处理。',
      null,
      `/dashboard/case/${row.id}`
    )
    return { changed: true as const }
  })
  if (!result.changed) return result
  const row = await getCaseById(db, caseId)
  if (row) await invalidateCasePatchCaches(db, [row.patch_id])
  return result
}

export const timeoutCloseCase = async (
  caseId: number,
  options: { now?: Date; db?: PrismaClient } = {}
) => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const result = await db.$transaction(async (tx) => {
    const row = await getCaseLock(tx, caseId)
    if (!row) return { changed: false as const, reason: '问题不存在' }
    if (
      row.owner_type !== 'publisher' ||
      !CASE_REPORTER_TIMEOUT_KINDS.includes(row.kind as never) ||
      row.status !== 'waiting_reporter' ||
      row.reporter_id === null ||
      row.status_changed_at.getTime() >=
        now.getTime() - CASE_REPORTER_TIMEOUT_AFTER_MS
    )
      return { changed: false as const }
    return closeCaseInternal(tx, {
      caseId: row.id,
      expectedStatuses: ['waiting_reporter'],
      resolution: 'reporter_unresponsive',
      actorType: 'system',
      event: 'resolved',
      now
    })
  })
  if (!result.changed) return result
  const row = await getCaseById(db, caseId)
  if (row) await invalidateCasePatchCaches(db, [row.patch_id])
  return result
}

export const getPublicResourceCaseBadges = async (
  resourceIds: number[],
  options: { db?: PrismaClient } = {}
) => {
  const db = options.db ?? prisma
  if (!resourceIds.length)
    return new Map<number, { reportCount: number; ownerType: CaseOwnerType }>()
  const rows = await db.ops_case.findMany({
    where: {
      target_type: 'resource',
      target_id: { in: resourceIds },
      public: true,
      status: { in: unresolvedStatuses }
    },
    select: {
      target_id: true,
      owner_type: true,
      _count: { select: { subscribers: true } }
    }
  })
  const result = new Map<
    number,
    { reportCount: number; ownerType: CaseOwnerType }
  >()
  for (const row of rows) {
    if (!isCaseOwnerType(row.owner_type)) continue
    result.set(row.target_id, {
      reportCount: row._count.subscribers,
      ownerType: row.owner_type
    })
  }
  return result
}

export const getAdminCaseInboxItems = async (
  input: { limit: number; search?: string },
  now = new Date(),
  db: PrismaClient = prisma
): Promise<{ items: CaseInboxItem[]; total: number }> => {
  const contains = {
    contains: input.search ?? '',
    mode: 'insensitive' as const
  }
  const where: Prisma.ops_caseWhereInput = {
    owner_type: 'staff',
    status: { in: unresolvedStatuses },
    ...(input.search
      ? { OR: [{ kind: contains }, { messages: { some: { body: contains } } }] }
      : {})
  }
  const [rows, total] = await Promise.all([
    db.ops_case.findMany({
      where,
      take: input.limit,
      orderBy: [{ status_changed_at: 'asc' }, { id: 'asc' }],
      select: caseSelect
    }),
    db.ops_case.count({ where })
  ])
  const items: CaseInboxItem[] = []
  for (const row of rows) {
    const item = await serializeAdminCaseInboxItem(db, row, now)
    if (item) items.push(item)
  }
  return { items, total }
}

const serializeAdminCaseInboxItem = async (
  db: CaseDb,
  row: CaseRow,
  now: Date
): Promise<CaseInboxItem | null> => {
  if (row.owner_type !== 'staff') return null
  const target = await loadTarget(db, row)
  const summary = toSummary(row, target, {
    identifyReporter: true,
    includeCount: true,
    includeOwner: true,
    includeReporter: true
  })
  const payload: AdminCaseInboxPayload = {
    id: summary.id,
    kind: summary.kind,
    targetType: summary.targetType,
    targetId: summary.targetId,
    target: summary.target,
    patchId: summary.patchId,
    ownerType: 'staff',
    status: summary.status,
    resolution: summary.resolution,
    subscriberCount: summary.subscriberCount ?? 0,
    created: summary.created,
    statusChangedAt: summary.statusChangedAt,
    queueEnteredAt: summary.queueEnteredAt
  }
  return {
    key: `case:${row.id}`,
    kind: 'case',
    id: row.id,
    title: `${CASE_KIND_LABELS[summary.kind]} #${row.id}`,
    subtitle:
      summary.target.patch?.name ?? summary.target.label ?? '目标已删除',
    actor: summary.reporter ?? null,
    waitingFrom: row.status_changed_at.toISOString(),
    waitingSeconds: Math.max(
      0,
      Math.floor((now.getTime() - row.status_changed_at.getTime()) / 1000)
    ),
    targetHref: `/dashboard/case/${row.id}`,
    badges: [CASE_KIND_LABELS[summary.kind]],
    readOnly: false,
    payload
  }
}

export const getAdminCaseInboxItem = async (
  caseId: number,
  now = new Date(),
  db: PrismaClient = prisma
): Promise<CaseInboxItem | null> => {
  const row = await db.ops_case.findUnique({
    where: { id: caseId },
    select: caseSelect
  })
  return row ? serializeAdminCaseInboxItem(db, row, now) : null
}

export const isKnownCaseAction = (action: string) =>
  (CASE_CONTENT_ACTIONS as readonly string[]).includes(action)
