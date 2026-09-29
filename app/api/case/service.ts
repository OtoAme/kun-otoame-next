import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import { convert as htmlToText } from 'html-to-text'
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
  CASE_CLOSING_EVENTS,
  CASE_CONTENT_ACTIONS,
  CASE_HANDLER_RESOLUTIONS_BY_KIND,
  CASE_KIND_LABELS,
  CASE_KIND_TARGETS,
  CASE_KINDS,
  CASE_MESSAGE_EVENTS,
  CASE_MESSAGE_KINDS,
  CASE_NOTICE_SNIPPET_LENGTH,
  CASE_OWNER_TYPES,
  CASE_PUBLISHER_ESCALATION_AFTER_MS,
  CASE_PUBLISHER_KINDS,
  CASE_PUBLISHER_TIMEOUT_KINDS,
  CASE_REMINDER_LEAD_MS,
  CASE_REPORTER_TIMEOUT_AFTER_MS,
  CASE_REPORTER_TIMEOUT_KINDS,
  CASE_RESOLUTIONS_BY_KIND,
  CASE_REOPEN_WINDOW_MS,
  CASE_RESOLUTIONS,
  CASE_SITE_TARGET_ID,
  CASE_STAFF_UNRESPONSIVE_AFTER_MS,
  CASE_STATUSES,
  CASE_TARGET_TYPE_LABELS,
  CASE_TARGET_TYPES,
  CASE_UNRESOLVED_STATUSES,
  CASE_WAITING_HANDLER_STATUSES,
  CASE_RESOLUTION_LABELS,
  caseTextHasGuideLink,
  isCaseOpenerScoped
} from '~/constants/case'
import type { CaseSearchField } from '~/constants/case'
import {
  caseImageUrl,
  consumeCaseImageUploads,
  restoreCaseImageUploads
} from './imageUpload'
import { checkCaseRateLimit } from './rateLimit'
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
  AdminCaseMessageHideResponse,
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
  CasePendingCountResponse,
  CaseResourceActionResponse,
  CaseReopenResponse,
  CaseResourceSummary,
  CaseStatusCounts,
  CaseSummary,
  CaseTargetContent,
  CaseTargetSummary,
  CaseUserSummary,
  AdminCaseInboxPayload,
  PatchCaseSummary
} from '~/types/api/case'
import type {
  adminCaseContentSchema,
  adminCaseHandleSchema,
  adminCaseListSchema,
  adminCaseMessageHideSchema,
  adminCaseResourceSchema,
  appendCaseMessageSchema,
  caseListSchema,
  createCaseSchema,
  resolveCaseSchema
} from '~/validations/case'
import type { z } from 'zod'

type CaseTx = Prisma.TransactionClient
type CaseDb = PrismaClient | CaseTx
/** Legacy report adapters construct inputs without images. */
type CreateCaseInput = Omit<z.infer<typeof createCaseSchema>, 'imageKeys'> & {
  imageKeys?: string[]
}
type CaseListInput = z.infer<typeof caseListSchema>
type AppendCaseInput = Omit<
  z.infer<typeof appendCaseMessageSchema>,
  'imageKeys'
> & {
  imageKeys?: string[]
  /** Site administrator replies only: false keeps the turn (D28). */
  awaitReporter?: boolean
}
type ResolveCaseInput = z.infer<typeof resolveCaseSchema>
type AdminListInput = Omit<
  z.infer<typeof adminCaseListSchema>,
  'ownerType' | 'searchField'
> & {
  ownerType?: CaseOwnerType
  searchField?: CaseSearchField
}
type AdminHandleInput = Omit<
  z.infer<typeof adminCaseHandleSchema>,
  'imageKeys'
> & { imageKeys?: string[] }
type AdminMessageHideInput = z.infer<typeof adminCaseMessageHideSchema>
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
  reminded_revision: true,
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
  reminded_revision: true,
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
  author: { select: { id: true, name: true, avatar: true, role: true } },
  images: {
    orderBy: { sort: 'asc' },
    select: { storage_key: true }
  }
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
      payload: true,
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

/**
 * Opener-scoped combinations (entry suggestions, site feedback) append the
 * opener, so each user keeps one open case of their own (D14, D21).
 */
export const buildCaseDedupKey = (
  targetType: CaseTargetType,
  targetId: number,
  kind: CaseKind,
  openerId?: number | null
) =>
  isCaseOpenerScoped(kind, targetType) &&
  openerId !== null &&
  openerId !== undefined
    ? `${targetType}:${targetId}:${kind}:${openerId}`
    : `${targetType}:${targetId}:${kind}`

export const buildCaseDailyKey = (
  userId: number,
  targetType: CaseTargetType,
  targetId: number,
  now = new Date()
) => `${userId}:${targetType}:${targetId}:${dateKey(now)}`

const toUser = (user: { id: number; name: string; avatar: string } | null) =>
  user ? { id: user.id, name: user.name, avatar: user.avatar } : null

const SITE_TARGET_LABEL = '站务反馈'

const targetSummary = (input: {
  targetType: CaseTargetType
  targetId: number
  patch?: CasePatchSummary | null
  resource?: CaseResourceSummary | null
  status?: number
  deleted?: boolean
  label?: string
}) =>
  ({
    targetType: input.targetType,
    targetId: input.targetId,
    deleted: input.deleted ?? (input.resource === null && input.patch === null),
    ...(input.status === undefined ? {} : { status: input.status }),
    patch: input.patch ?? null,
    resource: input.resource ?? null,
    ...(input.label ? { label: input.label } : {})
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
    // Only the public publisher kinds (description mismatch and the interim
    // link failure) belong to the publisher. Wrong patch and the frozen
    // resource violation flow are station cases even when the resource author
    // is an ordinary publisher.
    const publisherKind = (CASE_PUBLISHER_KINDS as readonly string[]).includes(
      kind
    )
    const publisherOwned = publisherKind && resource.user.role <= 2
    const ownerType: CaseOwnerType = publisherOwned ? 'publisher' : 'staff'
    const ownerId = publisherOwned ? resource.user_id : null
    return {
      targetType,
      targetId,
      patchId: resource.patch_id,
      ownerType,
      ownerId,
      public: publisherKind,
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

  if (targetType === 'site') {
    if (targetId !== CASE_SITE_TARGET_ID) return '站务反馈的目标不合法'
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
        resource: null,
        deleted: false,
        label: SITE_TARGET_LABEL
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
             reminded_revision, reporter_id, created, updated
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
  /** Reported content; loaded for single-case reads only. */
  content?: CaseTargetContent | null
}

const TARGET_CONTENT_MAX_LENGTH = 1000
const authorSelect = { id: true, name: true, avatar: true } as const

const contentText = (text: string, html = false) => {
  const plain = html ? htmlToText(text, { wordwrap: false }) : text
  return plain.trim().slice(0, TARGET_CONTENT_MAX_LENGTH)
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
  if (row.target_type === 'site') return { targetExists: true }
  const patch = row.patch_id
    ? await db.patch.findUnique({
        where: { id: row.patch_id },
        select: { id: true, unique_id: true, name: true }
      })
    : null
  let targetExists = false
  let content: CaseTargetContent | null = null
  if (row.target_type === 'comment') {
    const comment = await db.patch_comment.findUnique({
      where: { id: row.target_id },
      select: { id: true, content: true, user: { select: authorSelect } }
    })
    targetExists = Boolean(comment)
    if (comment) {
      content = {
        text: contentText(comment.content, true),
        author: comment.user
      }
    }
  } else if (row.target_type === 'rating') {
    const rating = await db.patch_rating.findUnique({
      where: { id: row.target_id },
      select: {
        id: true,
        overall: true,
        short_summary: true,
        user: { select: authorSelect }
      }
    })
    targetExists = Boolean(rating)
    if (rating) {
      content = {
        text: contentText(rating.short_summary),
        author: rating.user,
        overall: rating.overall
      }
    }
  } else if (row.target_type === 'shoutbox') {
    const shoutbox = await db.shoutbox.findUnique({
      where: { id: row.target_id },
      select: {
        id: true,
        status: true,
        content: true,
        user: { select: authorSelect }
      }
    })
    targetExists = Boolean(shoutbox)
    return {
      targetExists,
      patch,
      shoutbox: shoutbox ? { status: shoutbox.status } : null,
      content: shoutbox
        ? { text: contentText(shoutbox.content), author: shoutbox.user }
        : null
    }
  } else if (row.target_type === 'user') {
    const user = await db.user.findUnique({
      where: { id: row.target_id },
      select: authorSelect
    })
    targetExists = Boolean(user)
    if (user) content = { text: '', author: user }
  }
  return { targetExists, patch, content }
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
    if (row.target_type === 'site') {
      targetByCaseId.set(row.id, { targetExists: true })
      continue
    }
    targetByCaseId.set(row.id, { targetExists: false, patch })
  }
  return targetByCaseId
}

/** Previews never show a hidden note, not even in the admin queue. */
const toMessagePreview = (
  row: Pick<
    CaseMessageRow,
    'id' | 'kind' | 'event' | 'payload' | 'body' | 'created'
  >
): CaseMessagePreview => ({
  id: row.id,
  kind: (CASE_MESSAGE_KINDS as readonly string[]).includes(row.kind)
    ? (row.kind as CaseMessageKind)
    : 'reply',
  event:
    row.event && (CASE_MESSAGE_EVENTS as readonly string[]).includes(row.event)
      ? (row.event as CaseMessageEvent)
      : null,
  body: isHiddenMessage(row) ? HIDDEN_MESSAGE_BODY : row.body,
  created: iso(row.created) ?? new Date(0).toISOString()
})

const toTargetSummary = (
  row: Pick<CaseRow, 'target_type' | 'target_id' | 'patch_id'>,
  target: TargetRows,
  includeContent = false
) => {
  const targetType = isCaseTargetType(row.target_type)
    ? row.target_type
    : ('patch' as const)
  const content =
    includeContent && target.content ? { content: target.content } : {}
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
    return {
      ...targetSummary({
        targetType,
        targetId: row.target_id,
        patch: patchSummary(target.patch ?? null),
        resource: null,
        status: target.shoutbox?.status,
        deleted: target.targetExists === false
      }),
      ...content
    }
  }
  if (targetType === 'site') {
    return targetSummary({
      targetType,
      targetId: row.target_id,
      patch: null,
      resource: null,
      deleted: false,
      label: SITE_TARGET_LABEL
    })
  }
  return {
    ...targetSummary({
      targetType,
      targetId: row.target_id,
      patch: patchSummary(target.patch ?? null),
      resource: null,
      deleted: target.targetExists === false
    }),
    ...content
  }
}

const sanitizePayload = (
  payload: Prisma.JsonValue | null
): CaseMessagePayload | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null
  return payload as CaseMessagePayload
}

const HIDDEN_MESSAGE_BODY = '该内容已被网站管理员隐藏。'

/** A reply or report note the site administrator hid; system rows never are. */
const isHiddenMessage = (
  row: Pick<CaseMessageRow, 'kind' | 'payload'>
): boolean =>
  row.kind !== 'system' &&
  typeof sanitizePayload(row.payload)?.hidden_at === 'string'

const serializeMessage = (
  row: CaseMessageRow,
  options: {
    identifyReporter: boolean
    reporterId?: number | null
    /** Admin views: payloads, and the original text of hidden notes. */
    includePayload: boolean
    /** Resource author of a case handed to the site administrator. */
    originalPublisherId?: number | null
  }
): CaseMessage => {
  const hidden = isHiddenMessage(row)
  const concealed = hidden && !options.includePayload
  const author = row.author ? toUser(row.author) : null
  const authorSide =
    row.kind !== 'reply' || !row.author
      ? undefined
      : row.author.role >= 3
        ? ('staff' as const)
        : options.originalPublisherId !== null &&
            options.originalPublisherId !== undefined &&
            row.author.id === options.originalPublisherId
          ? ('original-publisher' as const)
          : undefined
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
    body: concealed ? HIDDEN_MESSAGE_BODY : row.body,
    author: safeAuthor,
    ...(options.includePayload
      ? { payload: sanitizePayload(row.payload) }
      : {}),
    ...(!concealed && row.images?.length
      ? { images: row.images.map((image) => caseImageUrl(image.storage_key)) }
      : {}),
    ...(hidden ? { hidden: true } : {}),
    ...(authorSide ? { authorSide } : {}),
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
    /** Admin detail: the reported comment, rating, shoutbox or user. */
    includeTargetContent?: boolean
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
    target: toTargetSummary(row, target, options.includeTargetContent),
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
  if (isOriginalPublisher(row, viewerId, originalPublisherId)) {
    return 'original-publisher' as const
  }
  if (subscribed && row.public) return 'subscriber-public' as const
  if (subscribed && !row.public) return 'subscriber-private' as const
  return null
}

/**
 * The publisher a public case was handed off from, by timeout or by the
 * opener's review request. For publisher kinds this is the resource author.
 */
const isOriginalPublisher = (
  row: Pick<CaseRow, 'public' | 'owner_type' | 'escalated_at'>,
  viewerId: number,
  originalPublisherId?: number
) =>
  row.public &&
  row.owner_type === 'staff' &&
  row.escalated_at !== null &&
  originalPublisherId === viewerId

/** Facts only a detail read loads; list rows leave these actions off. */
type CaseRoundFacts = {
  lastClosureActor: CaseActorType | null
  confirmedThisRound: boolean
}

const capabilitiesFor = (
  row: CaseRow,
  viewerId: number,
  viewerRole: number,
  target?: TargetRows,
  round?: CaseRoundFacts
): CaseCapabilities => {
  const unresolved = unresolvedStatuses.includes(row.status as never)
  const closed = closedStatuses.includes(row.status as never)
  const owner = row.owner_type === 'publisher' && row.owner_id === viewerId
  const admin = viewerRole >= 3
  const reporter = row.reporter_id === viewerId
  const withinReopenWindow =
    row.closed_at !== null &&
    row.closed_at.getTime() >= Date.now() - CASE_REOPEN_WINDOW_MS
  const originalPublisher =
    !admin && isOriginalPublisher(row, viewerId, target?.resource?.user_id)
  const handlerResolutions: CaseResolution[] =
    !isCaseKind(row.kind) || (!admin && !owner)
      ? []
      : row.kind === 'resource_wrong_patch'
        ? ['not_established']
        : row.kind === 'content_violation'
          ? row.target_type === 'user' && viewerRole >= 4
            ? ['not_established', 'handled']
            : ['not_established']
          : [...CASE_HANDLER_RESOLUTIONS_BY_KIND[row.kind]]
  const allowedResolutions: CaseResolution[] =
    admin && canCloseAsStaffUnresponsive(row, new Date())
      ? [...handlerResolutions, 'reporter_unresponsive']
      : handlerResolutions
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
    canReply: unresolved && (admin || owner || reporter || originalPublisher),
    canResolve: unresolved && allowedResolutions.length > 0 && (admin || owner),
    canReopen:
      reporter && closed && row.reopened_count === 0 && withinReopenWindow,
    canWithdraw: reporter && unresolved,
    canConfirm:
      reporter &&
      closed &&
      withinReopenWindow &&
      round !== undefined &&
      !round.confirmedThisRound,
    canReview:
      reporter &&
      closed &&
      withinReopenWindow &&
      row.owner_type === 'publisher' &&
      row.reopened_count === 1 &&
      round?.lastClosureActor === 'publisher',
    canPropose: unresolved && originalPublisher,
    // D13: a timed-out description case is fixed and closed, never hidden.
    canHideResource:
      admin &&
      unresolved &&
      row.kind === 'content_violation' &&
      row.target_type === 'resource',
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
    canHideMessages: admin,
    allowedContentActions,
    allowedResolutions
  }
}

/**
 * D24: a staff case never times out (D5), but once it has waited on its
 * reporter as long as the publisher-side timeout the site administrator may
 * record 开启者未回应 by hand.
 */
const canCloseAsStaffUnresponsive = (
  row: Pick<
    CaseRow,
    'kind' | 'owner_type' | 'status' | 'reporter_id' | 'status_changed_at'
  >,
  now: Date
) =>
  row.owner_type === 'staff' &&
  row.status === 'waiting_reporter' &&
  row.reporter_id !== null &&
  assertResolution(row.kind, 'reporter_unresponsive') &&
  row.status_changed_at.getTime() <=
    now.getTime() - CASE_STAFF_UNRESPONSIVE_AFTER_MS

/** Violation reports are private: reporters never learn about each other. */
const isViolationReport = (row: Pick<CaseRow, 'kind'>) =>
  row.kind === 'content_violation'

/**
 * Other reporters' notes a viewer must not read: followers see only their
 * own note. The opener of a violation report reads their own notes, the site
 * administrator's replies and the system rows, but not who else reported or
 * handed the case over (D15, D31, D33).
 */
const messageWhereForViewer = (
  row: Pick<CaseRow, 'id' | 'kind'>,
  view: NonNullable<ReturnType<typeof canViewCase>>,
  viewerId: number
): Prisma.ops_case_messageWhereInput =>
  view === 'subscriber-public' || view === 'subscriber-private'
    ? { case_id: row.id, kind: 'report', author_id: viewerId }
    : view === 'reporter' && isViolationReport(row)
      ? {
          case_id: row.id,
          OR: [
            { author_id: viewerId },
            { kind: 'reply', author: { is: { role: { gte: 3 } } } },
            {
              kind: 'system',
              OR: [{ event: null }, { event: { not: 'withdrawn' } }]
            }
          ]
        }
      : { case_id: row.id }

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
  // D15: everyone who can read the dialogue sees real signatures. Followers
  // never read the dialogue, so they never learn other reporters either.
  const full =
    view === 'admin' ||
    view === 'reporter' ||
    view === 'publisher' ||
    view === 'original-publisher'
  // D31: the opener of a violation report is just one of its reporters, so
  // the count stays with the site administrator as it does for followers.
  const privateReporter = view === 'reporter' && isViolationReport(row)
  return {
    view,
    identifyReporter: full,
    includeCount: (full && !privateReporter) || view === 'subscriber-public',
    includeOwner:
      view === 'admin' || view === 'reporter' || view === 'publisher',
    includeReporter: full
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

/** Single-line, bounded excerpt of a user-written text for notification bodies. */
const noticeSnippet = (text: string | null | undefined) => {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!flat) return ''
  return flat.length > CASE_NOTICE_SNIPPET_LENGTH
    ? `${flat.slice(0, CASE_NOTICE_SNIPPET_LENGTH)}…`
    : flat
}

/**
 * Followers answered nothing wrong: when a case ends as 开启者未回应, by the
 * timeout or by hand (D24), they learn the first reporter went quiet and that
 * a new report is welcome (D15).
 */
const unresponsiveFollowerNotice = (subject: string) =>
  `${subject}的首位报告者没有补充材料，事项已结束；如果你仍遇到这个问题，可以重新提交。`

const withSnippet = (sentence: string, text: string | null | undefined) => {
  const snippet = noticeSnippet(text)
  return snippet ? `${sentence}：${snippet}` : `${sentence}。`
}

const clip = (name: string) =>
  name.length > 30 ? `${name.slice(0, 30)}…` : name

/**
 * Names the case in a notification (D22) without exposing private content:
 * a resource or patch by name, a report only by what kind of thing it is.
 */
const describeCaseForNotice = async (
  db: CaseDb,
  row: Pick<CaseRow, 'target_type' | 'target_id'>
) => {
  if (row.target_type === 'resource') {
    const resource = await db.patch_resource.findUnique({
      where: { id: row.target_id },
      select: { name: true }
    })
    return resource ? `资源「${clip(resource.name)}」` : '资源问题'
  }
  if (row.target_type === 'patch') {
    const patch = await db.patch.findUnique({
      where: { id: row.target_id },
      select: { name: true }
    })
    return patch ? `条目「${clip(patch.name)}」` : '条目问题'
  }
  if (row.target_type === 'site') return SITE_TARGET_LABEL
  const label = isCaseTargetType(row.target_type)
    ? CASE_TARGET_TYPE_LABELS[row.target_type]
    : '内容'
  return `${label}举报`
}

const loadStaffIds = async (tx: CaseTx) =>
  (
    await tx.user.findMany({
      where: { role: { gte: 3 } },
      select: { id: true }
    })
  ).map(({ id }) => id)

const notifyCaseParticipants = async (
  tx: CaseTx,
  row: CaseRow,
  content: string,
  senderId?: number | null,
  options: {
    /** Users who acted themselves and need no notice about it. */
    excludeUserIds?: readonly number[]
    /** Text for users who only follow the case (D15). */
    followerContent?: string
  } = {}
) => {
  const recipients = new Map<
    number,
    {
      link: string
      senderId: number | null
      priority: number
      followerOnly: boolean
    }
  >()
  const linkPriority = (link: string) =>
    link === `/dashboard/case/${row.id}` ? 3 : link === caseLink(row.id) ? 2 : 1
  const addRecipient = (
    recipientId: number | null | undefined,
    link: string,
    recipientSenderId: number | null = null,
    followerOnly = false
  ) => {
    if (
      !Number.isInteger(recipientId) ||
      recipientId === undefined ||
      recipientId === null ||
      recipientId <= 0 ||
      options.excludeUserIds?.includes(recipientId)
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
        priority,
        followerOnly: followerOnly && (existing?.followerOnly ?? true)
      })
    } else if (!followerOnly) {
      existing.followerOnly = false
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
  for (const { user_id } of subscribers) {
    addRecipient(user_id, caseLink(row.id), null, true)
  }
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
    for (const id of await loadStaffIds(tx)) {
      addRecipient(id, `/dashboard/case/${row.id}`, senderId ?? null)
    }
  }
  if (!recipients.size) return
  await tx.user_message.createMany({
    data: [...recipients].map(([recipient_id, value]) => ({
      type: 'system',
      content:
        value.followerOnly && options.followerContent
          ? options.followerContent
          : content,
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
  /** Image keys already consumed from the upload registry by the caller. */
  imageKeys?: readonly string[]
  source?: CaseSource
  expectedPatchId?: number
  now?: Date
  allowFrozen?: boolean
  /**
   * The opener's resubmission turns into a reply that notifies the handler,
   * so a non-administrator submitting from a page counts it toward the
   * per-case reply cap (D29).
   */
  limitSupplement?: boolean
}

const imageCreate = (imageKeys: readonly string[] | undefined) =>
  imageKeys?.length
    ? {
        images: {
          create: imageKeys.map((storage_key, sort) => ({ storage_key, sort }))
        }
      }
    : {}

type ReplyActor = 'reporter' | 'owner' | 'staff' | 'original-publisher'

const replyActorFor = (
  row: CaseRow,
  uid: number,
  role: number,
  originalPublisherId?: number
): ReplyActor | null => {
  if (role >= 3) return 'staff'
  if (row.reporter_id === uid) return 'reporter'
  if (row.owner_type === 'publisher' && row.owner_id === uid) return 'owner'
  if (isOriginalPublisher(row, uid, originalPublisherId)) {
    return 'original-publisher'
  }
  return null
}

const originalPublisherIdFor = async (
  db: CaseDb,
  row: Pick<CaseRow, 'target_type' | 'target_id' | 'escalated_at'>
) => {
  if (row.target_type !== 'resource' || row.escalated_at === null) {
    return undefined
  }
  const resource = await db.patch_resource.findUnique({
    where: { id: row.target_id },
    select: { user_id: true }
  })
  return resource?.user_id
}

/**
 * Writes one dialogue reply inside the caller's transaction and applies the
 * reply rows of the transition table (plan 5.4). A reply from the publisher a
 * case was handed off from never changes state or the first-response time.
 *
 * A processing party's reply hands the turn to the reporter. Only the site
 * administrator may pass `awaitReporter: false` to answer without doing so;
 * the case then keeps its state and its place in the queue (D28).
 */
const appendReplyInTx = async (
  tx: CaseTx,
  row: CaseRow,
  uid: number,
  actor: ReplyActor,
  content: string,
  imageKeys: readonly string[],
  now: Date,
  awaitReporter = true
): Promise<CaseMessageRow | string> => {
  const isReporter = actor === 'reporter'
  const isProcessingParty = actor === 'owner' || actor === 'staff'
  const handOver = actor !== 'staff' || awaitReporter
  const nextStatus: CaseStatus =
    isReporter && row.status === 'waiting_reporter'
      ? 'waiting_owner'
      : isProcessingParty &&
          handOver &&
          row.reporter_id !== null &&
          (row.status === 'open' || row.status === 'waiting_owner')
        ? 'waiting_reporter'
        : (row.status as CaseStatus)
  const stateChanged = nextStatus !== row.status
  // Only the owning side's own answer is the owner's first response: a site
  // administrator stepping into a publisher's case does not count (D32).
  const ownersOwnReply =
    actor === 'owner' || (actor === 'staff' && row.owner_type === 'staff')
  const firstOwnerResponse =
    ownersOwnReply && row.first_owner_response_at === null ? now : null
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
      body: content,
      created: now,
      ...imageCreate(imageKeys)
    },
    select: messageSelect
  })
  const notice = withSnippet(
    `${await describeCaseForNotice(tx, row)}有新的回复`,
    content
  )
  const senderId = isReporter ? null : uid
  const others = (ids: readonly (number | null | undefined)[]) =>
    ids.filter((id): id is number => typeof id === 'number' && id !== uid)
  if (isReporter || actor === 'original-publisher') {
    if (row.owner_type === 'publisher' && row.owner_id !== null) {
      await notifyCaseUsers(tx, row.id, others([row.owner_id]), notice)
    } else {
      await notifyCaseUsers(
        tx,
        row.id,
        others(await loadStaffIds(tx)),
        notice,
        senderId,
        `/dashboard/case/${row.id}`
      )
    }
  } else {
    // The site administrator's answer also reaches the publisher still
    // owning the case, who would otherwise miss an intervention before the
    // handoff (review item 19).
    await notifyCaseUsers(
      tx,
      row.id,
      others([
        row.reporter_id,
        actor === 'staff' && row.owner_type === 'publisher'
          ? row.owner_id
          : null
      ]),
      notice,
      uid
    )
  }
  // D20: the publisher a case was handed off from still answers and proposes
  // closures, so the administrator's and the reporter's replies reach them.
  if (isReporter || actor === 'staff') {
    const originalPublisherId =
      row.owner_type === 'staff' && row.public
        ? await originalPublisherIdFor(tx, row)
        : undefined
    await notifyCaseUsers(
      tx,
      row.id,
      others([originalPublisherId]),
      notice,
      senderId
    )
  }
  return message
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
    input.kind,
    input.reporterId
  )
  const source = input.source ?? 'system'
  const body = input.content?.trim() ?? ''
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

  /**
   * Dedup hit: register the follower and keep what they wrote (D15). The
   * opener resubmitting is a supplement and follows the reply transitions; a
   * later reporter's note changes no state and sends no notice.
   */
  const joinOpenCase = async (caseId: number) => {
    const locked = await getCaseLock(tx, caseId)
    if (!locked) return '问题不存在'
    if (!unresolvedStatuses.includes(locked.status as never)) {
      return {
        justClosed: true as const,
        caseId: locked.id,
        created: false,
        subscribed: false
      }
    }
    let subscribed = false
    if (input.reporterId !== null && input.reporterId !== undefined) {
      const result = await tx.ops_case_subscriber.createMany({
        data: [{ case_id: locked.id, user_id: input.reporterId }],
        skipDuplicates: true
      })
      subscribed = result.count > 0
      if (body && locked.reporter_id === input.reporterId) {
        // The case is only known here, so the cap is checked inside the
        // transaction; a refusal rolls the subscription back with it.
        if (input.limitSupplement) {
          const limited = await checkCaseRateLimit(
            'message',
            input.reporterId,
            locked.id
          )
          if (limited) rollbackCaseOperation(limited)
        }
        const reply = await appendReplyInTx(
          tx,
          locked,
          input.reporterId,
          'reporter',
          body,
          input.imageKeys ?? [],
          now
        )
        // The subscription row is already written; roll it back with the
        // failed supplement instead of committing half the request.
        if (typeof reply === 'string') rollbackCaseOperation(reply)
      } else if (body) {
        await tx.ops_case_message.create({
          data: {
            case_id: locked.id,
            author_id: input.reporterId,
            kind: 'report',
            body,
            created: now,
            ...imageCreate(input.imageKeys)
          }
        })
      }
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

  const existing = await tx.ops_case.findUnique({
    where: { dedup_key: dedupKey },
    select: { id: true, status: true, reporter_id: true }
  })
  if (existing) return joinOpenCase(existing.id)

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
    if (winner) return joinOpenCase(winner.id)
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
  if (body) {
    await tx.ops_case_message.create({
      data: {
        case_id: row.id,
        author_id: input.reporterId ?? null,
        kind: 'reply',
        body,
        created: now,
        ...imageCreate(input.imageKeys)
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
  const ownerNotice = withSnippet(
    `${await describeCaseForNotice(tx, row)}有新的「${CASE_KIND_LABELS[input.kind]}」待处理`,
    body
  )
  if (row.owner_type === 'publisher' && row.owner_id !== null) {
    await notifyCaseUsers(tx, row.id, [row.owner_id], ownerNotice)
  } else {
    await notifyCaseUsers(
      tx,
      row.id,
      await loadStaffIds(tx),
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
  /** Users who performed the closure themselves (a withdrawing opener). */
  excludeRecipientIds?: readonly number[]
  /** Replacement text for followers who are neither opener nor owner. */
  followerNotice?: string
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
  // Every staff closure, whatever action performed it, is one processed
  // item for the dashboard's「今日已处理」(review item 24).
  if (input.actorType === 'staff' && input.actorId) {
    await tx.admin_log.create({
      data: {
        type: 'case_close',
        user_id: input.actorId,
        content: `管理员以「${CASE_RESOLUTION_LABELS[input.resolution]}」结案问题 #${row.id}`
      }
    })
  }
  const subject = await describeCaseForNotice(tx, row)
  await notifyCaseParticipants(
    tx,
    row,
    withSnippet(
      `${subject}已有处理结果：${CASE_RESOLUTION_LABELS[input.resolution]}`,
      input.body
    ),
    input.actorId,
    {
      // Whoever closed the case needs no notice about it (review item 22).
      excludeUserIds: [
        ...(input.excludeRecipientIds ?? []),
        ...(input.actorId ? [input.actorId] : [])
      ],
      followerContent: input.followerNotice
    }
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
  const admin = view === 'admin'
  const summary = toSummary(row, target, {
    ...options,
    includeTargetContent: admin
  })
  const follower = view === 'subscriber-public' || view === 'subscriber-private'
  // Followers only read back the note they wrote themselves (D15).
  const messagesRows = await db.ops_case_message.findMany({
    where: messageWhereForViewer(row, view, viewerId),
    orderBy: [{ created: 'asc' }, { id: 'asc' }],
    select: messageSelect
  })
  const capabilities = capabilitiesFor(
    row,
    viewerId,
    viewerRole,
    target,
    follower ? undefined : roundFacts(messagesRows)
  )
  // An opener who withdrew while others still follow keeps reading the case
  // but has nothing left to withdraw (D18).
  if (!subscription) capabilities.canWithdraw = false
  const relatedOpenCaseIds = admin ? await loadRelatedOpenCaseIds(db, row) : []
  const handedOffFrom =
    row.public && row.owner_type === 'staff' && row.escalated_at !== null
      ? target.resource?.user_id
      : null
  const detail: CaseDetail = {
    ...summary,
    messages: messagesRows.map((message) =>
      serializeMessage(message, {
        identifyReporter: options.identifyReporter || follower,
        reporterId: row.reporter_id,
        includePayload: admin,
        originalPublisherId: handedOffFrom
      })
    ),
    // A follower of a private report joined by submitting one of their own.
    ...(view === 'subscriber-private'
      ? { viewerSubscription: { subscribed: true, submitted: true } }
      : {}),
    ...(relatedOpenCaseIds.length ? { relatedOpenCaseIds } : {}),
    capabilities
  }
  return { case: detail }
}

const RELATED_OPEN_CASE_LIMIT = 20

/**
 * Opener-scoped cases on a game never merge (D14, D26). After fixing the
 * entry the administrator needs the other open ones of the same kind, which
 * are only listed here; closing them stays one case at a time.
 */
const loadRelatedOpenCaseIds = async (db: CaseDb, row: CaseRow) => {
  if (
    row.target_type !== 'patch' ||
    !isCaseOpenerScoped(row.kind, row.target_type)
  ) {
    return []
  }
  const rows = await db.ops_case.findMany({
    where: {
      id: { not: row.id },
      kind: row.kind,
      target_type: 'patch',
      target_id: row.target_id,
      status: { in: unresolvedStatuses }
    },
    orderBy: [{ id: 'asc' }],
    take: RELATED_OPEN_CASE_LIMIT,
    select: { id: true }
  })
  return rows.map((related) => related.id)
}

/** Who closed the current round, and whether its opener already answered it. */
const roundFacts = (
  messages: readonly Pick<CaseMessageRow, 'kind' | 'event' | 'payload'>[]
): CaseRoundFacts => {
  let lastClosureActor: CaseActorType | null = null
  let confirmedThisRound = false
  for (const message of messages) {
    if (message.kind !== 'system' || !message.event) continue
    if ((CASE_CLOSING_EVENTS as readonly string[]).includes(message.event)) {
      const actor = sanitizePayload(message.payload)?.actor_type
      lastClosureActor =
        actor && (CASE_ACTOR_TYPES as readonly string[]).includes(actor)
          ? actor
          : null
      confirmedThisRound = false
    } else if (message.event === 'confirmed') {
      confirmedThisRound = true
    }
  }
  return { lastClosureActor, confirmedThisRound }
}

export const getCase = async (
  caseId: number,
  viewerId: number,
  viewerRole: number,
  options: { db?: PrismaClient } = {}
) => {
  const db = options.db ?? prisma
  const result = await fetchCaseForViewer(db, caseId, viewerId, viewerRole)
  // Opening the case reads its notices, which clears the list's「有新回复」(D22).
  if (typeof result !== 'string') {
    await db.user_message.updateMany({
      where: { recipient_id: viewerId, status: 0, link: caseLink(caseId) },
      data: { status: 1 }
    })
  }
  return result
}

export const createCase = async (
  input: CreateCaseInput,
  reporterId: number,
  /** `role` exempts site administrators from the reply cap (D29). */
  options: { now?: Date; db?: PrismaClient; role?: number } = {}
): Promise<CaseCreateResponse | string> => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const imageKeys = input.imageKeys ?? []
  const consumed = await consumeCaseImageUploads(reporterId, imageKeys)
  if (consumed) return consumed
  let result: Awaited<ReturnType<typeof openCaseInternal>> | string
  try {
    result = await runCaseOperation(db, (tx) =>
      openCaseInternal(tx, {
        kind: input.kind,
        targetType: input.targetType,
        targetId: input.targetId,
        expectedPatchId: input.expectedPatchId,
        reporterId,
        content: input.content,
        imageKeys,
        source: 'user',
        now,
        limitSupplement: (options.role ?? 0) < 3
      })
    )
  } catch (error) {
    await restoreCaseImageUploads(reporterId, imageKeys)
    throw error
  }
  if (typeof result === 'string' || result.justClosed) {
    await restoreCaseImageUploads(reporterId, imageKeys)
  }
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

/**
 * Public cases handed off from the viewer's resources to the site
 * administrator. They stay listed under「待我处理」so the publisher can still
 * reply and propose a closure (D20).
 */
const loadHandedOffCaseIds = async (db: CaseDb, uid: number) => {
  const rows = await db.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    SELECT c.id
    FROM ops_case c
    JOIN patch_resource r ON r.id = c.target_id
    WHERE c.target_type = 'resource'
      AND c.public = TRUE
      AND c.owner_type = 'staff'
      AND c.escalated_at IS NOT NULL
      AND r.user_id = ${uid}
    ORDER BY c.id DESC
    LIMIT 500
  `)
  return Array.isArray(rows)
    ? rows.map((row) => Number(row.id)).filter(Number.isSafeInteger)
    : []
}

const getTabWhere = async (
  db: CaseDb,
  tab: CaseTab,
  uid: number
): Promise<{ where: Prisma.ops_caseWhereInput; handedOff: Set<number> }> => {
  if (tab === 'owned') {
    const handedOff = new Set(await loadHandedOffCaseIds(db, uid))
    const owned: Prisma.ops_caseWhereInput = {
      owner_type: 'publisher',
      owner_id: uid
    }
    return {
      where: handedOff.size
        ? { OR: [owned, { id: { in: [...handedOff] } }] }
        : owned,
      handedOff
    }
  }
  if (tab === 'subscribed') {
    return {
      where: { subscribers: { some: { user_id: uid } } },
      handedOff: new Set()
    }
  }
  return { where: { reporter_id: uid }, handedOff: new Set() }
}

/** Cases the viewer still has an unread notification for (D22). */
const loadUnreadCaseIds = async (
  db: CaseDb,
  viewerId: number,
  caseIds: readonly number[]
) => {
  if (!caseIds.length) return new Set<number>()
  const links = caseIds.map(caseLink)
  const rows = await db.user_message.findMany({
    where: { recipient_id: viewerId, status: 0, link: { in: links } },
    select: { link: true }
  })
  return new Set(rows.map((row) => Number(row.link.replace(/^\/issue\//, ''))))
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
  const { where: scopeWhere, handedOff } = await getTabWhere(
    db,
    input.tab,
    viewerId
  )
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
  const [targetByCaseId, subscribedRows, unreadCaseIds] = await Promise.all([
    loadTargets(db, rows),
    queryManyIfNeeded(caseIds, () =>
      db.ops_case_subscriber.findMany({
        where: { case_id: { in: caseIds }, user_id: viewerId },
        select: { case_id: true }
      })
    ),
    loadUnreadCaseIds(db, viewerId, caseIds)
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
    let latestMessage: (typeof row.messages)[number] | undefined =
      row.messages?.[0]
    // A violation report's opener never previews another reporter's note (D31).
    if (
      latestMessage?.kind === 'report' &&
      serialized.view === 'reporter' &&
      isViolationReport(row)
    ) {
      latestMessage =
        (await db.ops_case_message.findFirst({
          where: messageWhereForViewer(row, serialized.view, viewerId),
          orderBy: [{ created: 'desc' }, { id: 'desc' }],
          select: caseListSelect.messages.select
        })) ?? undefined
    }
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
      hasUnread: unreadCaseIds.has(row.id),
      handedOff: handedOff.has(row.id),
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

export const appendCaseMessage = async (
  input: AppendCaseInput,
  uid: number,
  role: number,
  options: { now?: Date; db?: PrismaClient } = {}
): Promise<CaseMessageResponse | string> => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  // Every reply notifies the other side, so a non-administrator's replies are
  // capped per case before any database or image work (D29).
  if (role < 3) {
    const limited = await checkCaseRateLimit('message', uid, input.caseId)
    if (limited) return limited
  }
  const imageKeys = input.imageKeys ?? []
  const consumed = await consumeCaseImageUploads(uid, imageKeys)
  if (consumed) return consumed
  let result: string | { row: CaseRow; message: CaseMessageRow }
  try {
    result = await db.$transaction(async (tx) => {
      const row = await getCaseLock(tx, input.caseId)
      if (!row) return '问题不存在'
      if (!unresolvedStatuses.includes(row.status as never))
        return '该问题已结案'
      const actor = replyActorFor(
        row,
        uid,
        role,
        await originalPublisherIdFor(tx, row)
      )
      if (!actor) return '无权回复该问题'
      const message = await appendReplyInTx(
        tx,
        row,
        uid,
        actor,
        input.content,
        imageKeys,
        now,
        input.awaitReporter ?? true
      )
      if (typeof message === 'string') return message
      return { row, message }
    })
  } catch (error) {
    await restoreCaseImageUploads(uid, imageKeys)
    throw error
  }
  if (typeof result === 'string') {
    await restoreCaseImageUploads(uid, imageKeys)
    return result
  }
  const row = await getCaseById(db, input.caseId)
  if (!row) return '问题不存在'
  const serialized = await serializeSummaryForViewer(db, row, uid, role, true)
  if (!serialized) return '问题不存在'
  return {
    case: serialized.summary,
    message: serializeMessage(result.message, {
      identifyReporter: true,
      reporterId: result.row.reporter_id,
      includePayload: role >= 3
    })
  }
}

/** Numbers behind the「问题处理」entry of the site user menu (D22). */
export const getPendingCaseCounts = async (
  uid: number,
  options: { db?: PrismaClient } = {}
): Promise<CasePendingCountResponse> => {
  const db = options.db ?? prisma
  const [owned, waitingReporter] = await Promise.all([
    db.ops_case.count({
      where: {
        owner_type: 'publisher',
        owner_id: uid,
        status: { in: ['open', 'waiting_owner'] }
      }
    }),
    db.ops_case.count({
      where: { reporter_id: uid, status: 'waiting_reporter' }
    })
  ])
  return { owned, waitingReporter }
}

const assertResolution = (kind: string, resolution: string) => {
  if (!isCaseKind(kind) || !isCaseResolution(resolution)) return false
  return CASE_RESOLUTIONS_BY_KIND[kind].includes(resolution)
}

const isHandlerResolution = (kind: string, resolution: string) =>
  isCaseKind(kind) &&
  isCaseResolution(resolution) &&
  CASE_HANDLER_RESOLUTIONS_BY_KIND[kind].includes(resolution)

/**
 * Closure notes the reporter is owed: what was checked for「无法复现」(D16),
 * the reason for「不采纳」(D25), and one of the three guides for「不在受理
 * 范围」(D12). Site feedback has no matching guide, so its out-of-scope
 * closure only needs the explanation.
 */
const closingNoteError = (
  row: Pick<CaseRow, 'kind' | 'target_type'>,
  resolution: CaseResolution,
  content: string
) => {
  if (resolution === 'unreproducible' && !content.trim()) {
    return '以「无法复现」结案时请写明核对了什么'
  }
  if (resolution === 'declined' && !content.trim()) {
    return '以「不采纳」结案时请写明理由'
  }
  if (resolution === 'out_of_scope') {
    if (row.kind === 'other' && row.target_type === 'site') {
      return content.trim() ? null : '以「不在受理范围」结案时请写明理由'
    }
    if (!caseTextHasGuideLink(content)) {
      return '以「不在受理范围」结案时请附上下载、压缩包或投稿指南中的一篇链接'
    }
  }
  return null
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
    if (!(CASE_PUBLISHER_KINDS as readonly string[]).includes(row.kind))
      return '当前问题不能由发布者结案'
    if (!isHandlerResolution(row.kind, input.resolution)) {
      return '发布者不能使用该结论'
    }
    const noteError = closingNoteError(row, input.resolution, input.content)
    if (noteError) return noteError
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

const notifyReopen = async (tx: CaseTx, row: CaseRow, reason: string) => {
  const notice = withSnippet(
    `${await describeCaseForNotice(tx, row)}被报告者重新打开`,
    reason
  )
  if (row.owner_type === 'publisher' && row.owner_id !== null) {
    await notifyCaseUsers(tx, row.id, [row.owner_id], notice)
  } else {
    await notifyCaseUsers(
      tx,
      row.id,
      await loadStaffIds(tx),
      notice,
      null,
      `/dashboard/case/${row.id}`
    )
  }
}

/** The opener's reason, recorded as their own reply after the event. */
const writeReporterReason = (
  tx: CaseTx,
  caseId: number,
  uid: number,
  content: string,
  now: Date
) =>
  tx.ops_case_message.create({
    data: {
      case_id: caseId,
      author_id: uid,
      kind: 'reply',
      body: content,
      created: now
    }
  })

export const reopenCase = async (
  caseId: number,
  uid: number,
  content: string,
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
        row.kind as CaseKind,
        row.reporter_id
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
      await writeReporterReason(tx, row.id, uid, content, now)
      await notifyReopen(tx, row, content)
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

const latestClosureActor = async (tx: CaseTx, caseId: number) => {
  const message = await tx.ops_case_message.findFirst({
    where: {
      case_id: caseId,
      kind: 'system',
      event: { in: [...CASE_CLOSING_EVENTS] }
    },
    orderBy: [{ created: 'desc' }, { id: 'desc' }],
    select: { payload: true }
  })
  return sanitizePayload(message?.payload ?? null)?.actor_type ?? null
}

const reserializeAfterAction = async (
  db: PrismaClient,
  caseId: number,
  uid: number,
  role: number
): Promise<CaseActionResponse | string> => {
  const row = await getCaseById(db, caseId)
  if (!row) return '问题不存在'
  await invalidateCasePatchCaches(db, [row.patch_id])
  const serialized = await serializeSummaryForViewer(db, row, uid, role, true)
  if (!serialized) return '问题不存在'
  return { case: serialized.summary, changed: true }
}

/**
 * Second-stage appeal (D16). After the publisher closed the reopened case, the
 * opener may hand it to the site administrator once. It reuses the handoff
 * shape of the timeout escalation, and the administrator's closure is final:
 * `reopened_count = 2` blocks both reopen and review afterwards.
 */
export const reviewCase = async (
  caseId: number,
  uid: number,
  content: string,
  options: { now?: Date; db?: PrismaClient } = {}
): Promise<CaseReopenResponse | string> => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  let conflictKey: string | null = null
  let result: { changed: true } | CaseReopenResponse | string
  try {
    result = await db.$transaction(async (tx) => {
      const row = await getCaseLock(tx, caseId)
      if (!row) return '问题不存在'
      if (row.reporter_id !== uid) return '只有开启者可以申请复核'
      if (!closedStatuses.includes(row.status as never))
        return '当前问题尚未结案'
      if (row.owner_type !== 'publisher' || row.reopened_count !== 1) {
        return '发布者在重新打开后再次结案，才能申请网站管理员复核'
      }
      if (
        !row.closed_at ||
        row.closed_at.getTime() < now.getTime() - CASE_REOPEN_WINDOW_MS
      ) {
        return '该问题已超过 7 天，不能申请复核'
      }
      if ((await latestClosureActor(tx, row.id)) !== 'publisher') {
        return '只有发布者给出的结论可以申请复核'
      }
      const dedupKey = buildCaseDedupKey(
        row.target_type as CaseTargetType,
        row.target_id,
        row.kind as CaseKind,
        row.reporter_id
      )
      conflictKey = dedupKey
      const collision = await tx.ops_case.findUnique({
        where: { dedup_key: dedupKey },
        select: { id: true }
      })
      if (collision && collision.id !== row.id) {
        return { conflict: true as const, existingCaseId: collision.id }
      }
      const updated = await tx.ops_case.updateMany({
        where: {
          id: row.id,
          status: row.status,
          revision: row.revision,
          owner_type: 'publisher',
          reopened_count: 1
        },
        data: {
          status: 'open',
          owner_type: 'staff',
          owner_id: null,
          dedup_key: dedupKey,
          status_changed_at: now,
          queue_entered_at: now,
          escalated_at: now,
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
          resolution: row.resolution,
          closed_at: iso(row.closed_at),
          first_owner_response_at: iso(row.first_owner_response_at),
          from_status: row.status,
          to_status: 'open',
          from_state_entered_at: row.status_changed_at.toISOString(),
          queue_entered_at: now.toISOString()
        },
        '报告者申请网站管理员复核。'
      )
      await appendCaseSystemMessage(
        tx,
        row.id,
        'escalated',
        {
          escalation_trigger: 'review_request',
          from_status: row.status,
          to_status: 'open',
          from_state_entered_at: row.status_changed_at.toISOString(),
          queue_entered_at: now.toISOString(),
          from_owner_type: row.owner_type,
          from_owner_id: row.owner_id
        },
        '问题已提交给网站管理员复核，网站管理员的结论为最终结果。'
      )
      await writeReporterReason(tx, row.id, uid, content, now)
      const subject = await describeCaseForNotice(tx, row)
      await notifyCaseUsers(
        tx,
        row.id,
        await loadStaffIds(tx),
        withSnippet(`${subject}的报告者申请网站管理员复核`, content),
        null,
        `/dashboard/case/${row.id}`
      )
      // The publisher can read the reason in the dialogue anyway, so the
      // notice carries the same snippet as the administrators' one.
      if (row.owner_id !== null) {
        await notifyCaseUsers(
          tx,
          row.id,
          [row.owner_id],
          withSnippet(`${subject}的报告者申请网站管理员复核`, content)
        )
      }
      return { changed: true as const }
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
  if (typeof result === 'string' || 'conflict' in result) return result
  return reserializeAfterAction(db, caseId, uid, 1)
}

/**
 * The opener takes the report back (D18). Without other followers the case
 * closes as「开启者撤回」; otherwise only the opener's subscription goes and
 * the case continues for the other reporters.
 */
export const withdrawCase = async (
  caseId: number,
  uid: number,
  options: { now?: Date; db?: PrismaClient } = {}
): Promise<CaseActionResponse | string> => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const result = await db.$transaction(async (tx) => {
    const row = await getCaseLock(tx, caseId)
    if (!row) return '问题不存在'
    if (row.reporter_id !== uid) return '只有开启者可以撤回'
    if (!unresolvedStatuses.includes(row.status as never)) return '该问题已结案'
    // The opener withdraws through their own subscription; without it there
    // is nothing left to withdraw (D18).
    const own = await tx.ops_case_subscriber.findUnique({
      where: { case_id_user_id: { case_id: row.id, user_id: uid } },
      select: { user_id: true }
    })
    if (!own) return '你已经撤回过这条问题'
    // D33: the earliest remaining reporter takes the case over, so somebody
    // can still answer the handler; the withdrawer leaves it completely.
    const successor = await tx.ops_case_subscriber.findFirst({
      where: { case_id: row.id, user_id: { not: uid } },
      orderBy: [{ created: 'asc' }, { user_id: 'asc' }],
      select: { user_id: true }
    })
    if (!successor) {
      const closed = await closeCaseInternal(tx, {
        caseId: row.id,
        expectedStatuses: [row.status as CaseStatus],
        resolution: 'reporter_withdrawn',
        actorType: 'reporter',
        actorId: uid,
        body: '报告者已撤回，事项结束。',
        excludeRecipientIds: [uid],
        now
      })
      return closed.changed ? { changed: true as const } : closed.reason
    }
    // A successor who now owes the handler an answer gets the full 14 days.
    const waitingOnReporter = row.status === 'waiting_reporter'
    const moved = await tx.ops_case.updateMany({
      where: {
        id: row.id,
        reporter_id: uid,
        status: row.status,
        revision: row.revision
      },
      data: {
        reporter_id: successor.user_id,
        ...(waitingOnReporter
          ? { status_changed_at: now, revision: { increment: 1 } }
          : {}),
        updated: now
      }
    })
    if (moved.count === 0) return '该问题刚刚被他人更新，请刷新后重试'
    await tx.ops_case_subscriber.deleteMany({
      where: { case_id: row.id, user_id: uid }
    })
    await appendCaseSystemMessage(
      tx,
      row.id,
      'withdrawn',
      { actor_type: 'reporter', successor_id: successor.user_id },
      '开启者已撤回自己的报告，改由下一位报告者跟进，事项继续处理。'
    )
    await notifyCaseUsers(
      tx,
      row.id,
      [successor.user_id],
      `${await describeCaseForNotice(tx, row)}改由你作为报告者跟进，处理方需要补充材料时会通知你。`
    )
    return { changed: true as const }
  })
  if (typeof result === 'string') return result
  return reserializeAfterAction(db, caseId, uid, 1)
}

/** 「解决了 / 没解决」for the latest closure, recorded once per round (D19). */
export const confirmCase = async (
  caseId: number,
  uid: number,
  solved: boolean,
  options: { now?: Date; db?: PrismaClient } = {}
): Promise<CaseActionResponse | string> => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const result = await db.$transaction(async (tx) => {
    const row = await getCaseLock(tx, caseId)
    if (!row) return '问题不存在'
    if (row.reporter_id !== uid) return '只有开启者可以确认处理结果'
    if (!closedStatuses.includes(row.status as never)) return '当前问题尚未结案'
    if (
      !row.closed_at ||
      row.closed_at.getTime() < now.getTime() - CASE_REOPEN_WINDOW_MS
    ) {
      return '该问题已超过 7 天，不能再确认'
    }
    const systemMessages = await tx.ops_case_message.findMany({
      where: { case_id: row.id, kind: 'system' },
      orderBy: [{ created: 'asc' }, { id: 'asc' }],
      select: { kind: true, event: true, payload: true }
    })
    if (roundFacts(systemMessages).confirmedThisRound) {
      return '你已经确认过这次处理结果'
    }
    await appendCaseSystemMessage(
      tx,
      row.id,
      'confirmed',
      {
        resolution: row.resolution,
        closed_at: iso(row.closed_at),
        solved
      },
      solved ? '报告者确认：问题已解决。' : '报告者确认：问题仍未解决。'
    )
    return { changed: true as const }
  })
  if (typeof result === 'string') return result
  return reserializeAfterAction(db, caseId, uid, 1)
}

/**
 * After a handoff the original publisher may still propose a closure (D20).
 * It changes no state; the administrator adopts it through `handle`.
 */
export const proposeCaseClosure = async (
  input: { caseId: number; resolution: CaseResolution; content: string },
  uid: number,
  role: number,
  options: { now?: Date; db?: PrismaClient } = {}
): Promise<CaseActionResponse | string> => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  if (role >= 3) return '网站管理员请直接结案'
  const result = await db.$transaction(async (tx) => {
    const row = await getCaseLock(tx, input.caseId)
    if (!row) return '问题不存在'
    if (!unresolvedStatuses.includes(row.status as never)) return '该问题已结案'
    if (!isOriginalPublisher(row, uid, await originalPublisherIdFor(tx, row))) {
      return '只有原发布者可以提请结案'
    }
    if (!isHandlerResolution(row.kind, input.resolution)) {
      return '当前问题不支持该结论'
    }
    const noteError = closingNoteError(row, input.resolution, input.content)
    if (noteError) return noteError
    const label = CASE_RESOLUTION_LABELS[input.resolution]
    // The note goes first so it sits right before its event by time and id.
    await tx.ops_case_message.create({
      data: {
        case_id: row.id,
        author_id: uid,
        kind: 'reply',
        body: input.content,
        created: now
      }
    })
    await appendCaseSystemMessage(
      tx,
      row.id,
      'close_proposed',
      { resolution: input.resolution },
      `原发布者提请以「${label}」结案。`
    )
    await notifyCaseUsers(
      tx,
      row.id,
      await loadStaffIds(tx),
      withSnippet(
        `${await describeCaseForNotice(tx, row)}的原发布者提请以「${label}」结案`,
        input.content
      ),
      uid,
      `/dashboard/case/${row.id}`
    )
    return { changed: true as const }
  })
  if (typeof result === 'string') return result
  return reserializeAfterAction(db, input.caseId, uid, role)
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
      {
        caseId: input.caseId,
        content: input.content,
        imageKeys: input.imageKeys ?? [],
        awaitReporter: input.awaitReporter
      },
      adminId,
      adminRole,
      options
    )
  }
  // D30: a closing note is the text of the closing event, which carries no
  // images; a picture goes into a reply first.
  if (input.imageKeys?.length) {
    return '结案说明不能附图，需要配图请先发一条带图回复'
  }
  const now = options.now ?? new Date()
  const result = await db.$transaction(async (tx) => {
    const row = await getCaseLock(tx, input.caseId)
    if (!row) return '问题不存在'
    let resolution = input.resolution
    if (input.action === 'reject' && resolution === undefined) {
      resolution = (CASE_PUBLISHER_KINDS as readonly string[]).includes(
        row.kind
      )
        ? 'out_of_scope'
        : 'not_established'
    }
    if (resolution === 'reporter_withdrawn') {
      return '开启者撤回只能由开启者本人登记'
    }
    if (!resolution) return '当前问题不支持该结论'
    const staffUnresponsive = resolution === 'reporter_unresponsive'
    if (staffUnresponsive) {
      if (!canCloseAsStaffUnresponsive(row, now)) {
        return '只有等待报告者满 14 天的站方事项可以登记「开启者未回应」'
      }
    } else if (!isHandlerResolution(row.kind, resolution)) {
      // D13 retired the escalated hide/ignore pair: handed-off cases use the
      // same closing resolutions as the publisher would have.
      return '当前问题不支持该结论'
    }
    if (resolution === 'not_established' && !input.content.trim()) {
      return '登记不成立必须填写处理说明'
    }
    const noteError = closingNoteError(row, resolution, input.content)
    if (noteError) return noteError
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
    if (['moved', 'violation_hidden', 'handled'].includes(resolution)) {
      const plainHandled =
        resolution === 'handled' &&
        (row.kind === 'other' ||
          row.kind === 'patch_info' ||
          (row.kind === 'content_violation' && row.target_type === 'user'))
      if (!plainHandled) return '该结论必须通过对应的处置动作完成'
    }
    if (
      input.action === 'reject' &&
      !(
        ['not_established', 'out_of_scope', 'declined'] as CaseResolution[]
      ).includes(resolution)
    ) {
      return '驳回只能使用不成立、不在受理范围或不采纳结论'
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
    // D25 records 不采纳 as a rejection whichever action carries it.
    const targetStatus =
      input.action === 'reject' || resolution === 'declined'
        ? 'rejected'
        : 'resolved'
    return closeCaseInternal(tx, {
      caseId: row.id,
      expectedStatuses: staffUnresponsive
        ? ['waiting_reporter']
        : (unresolvedStatuses as CaseStatus[]),
      resolution,
      actorType: 'staff',
      actorId: adminId,
      body: input.content || undefined,
      status: targetStatus,
      ...(staffUnresponsive
        ? {
            followerNotice: unresponsiveFollowerNotice(
              await describeCaseForNotice(tx, row)
            )
          }
        : {}),
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
      // D13: a timed-out description case is fixed and closed, never hidden;
      // only a resource violation report may hide the resource.
      if (
        !unresolvedStatuses.includes(initial.status as never) ||
        initial.kind !== 'content_violation' ||
        initial.target_type !== 'resource'
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
      const closed = await closeCaseInternal(tx, {
        caseId: initial.id,
        expectedStatuses: unresolvedStatuses as CaseStatus[],
        resolution: 'violation_hidden',
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
        // A misjudgement restore is a 不成立 finding: rejected like every
        // other 不成立, whichever action records it (D25 precedent).
        status: input.action === 'restore' ? 'rejected' : 'resolved',
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
      let deletedLabel: string | null = null
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
          deletedLabel = '评论'
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
          deletedLabel = '评价'
        }
      } else {
        return '评论和评价使用 delete，小喇叭请使用 takedown 或 restore'
      }
      // The shoutbox primitives log their own moderation; a deletion through
      // the case needs its own record (review item 24).
      if (deletedLabel) {
        await tx.admin_log.create({
          data: {
            type: 'case_content_delete',
            user_id: adminId,
            content: `管理员通过问题 #${row.id} 删除${deletedLabel} #${row.target_id}`
          }
        })
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
          row.id,
          now
        )
        if (typeof removed === 'string') return removed
      } else if (input.action === 'restore') {
        const restored = await restoreShoutboxForCase(
          tx,
          row.target_id,
          adminId,
          row.id,
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
      status: input.action === 'restore' ? 'rejected' : 'resolved',
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

/**
 * Hides or unhides one reply or later-reporter note (D27). Only that row's
 * `payload.hidden_at` changes: the case keeps its state and revision, nobody
 * is notified, and admin_log records who acted. The condition on the value
 * just read turns a repeated or crossed request into a refusal, not a flip.
 */
export const setCaseMessageHidden = async (
  input: AdminMessageHideInput,
  adminId: number,
  adminRole: number,
  options: { now?: Date; db?: PrismaClient } = {}
): Promise<AdminCaseMessageHideResponse | string> => {
  const db = options.db ?? prisma
  if (adminRole < 3) return '本页面仅管理员可访问'
  const now = options.now ?? new Date()
  const result = await db.$transaction(async (tx) => {
    const message = await tx.ops_case_message.findFirst({
      where: { id: input.messageId, case_id: input.caseId },
      select: { id: true, kind: true, payload: true }
    })
    if (!message) return '该对话不存在'
    if (message.kind !== 'reply' && message.kind !== 'report') {
      return '系统消息不能隐藏'
    }
    const hiddenAt = sanitizePayload(message.payload)?.hidden_at
    const currentlyHidden = typeof hiddenAt === 'string'
    if (currentlyHidden === input.hidden) return { changed: false as const }
    const updated = await tx.ops_case_message.updateMany({
      where: {
        id: message.id,
        case_id: input.caseId,
        payload:
          typeof hiddenAt === 'string'
            ? { path: ['hidden_at'], equals: hiddenAt }
            : { equals: Prisma.AnyNull }
      },
      data: {
        payload: input.hidden ? { hidden_at: now.toISOString() } : Prisma.DbNull
      }
    })
    if (updated.count === 0) return '该对话刚刚被他人处理，请刷新后重试'
    await tx.admin_log.create({
      data: {
        type: input.hidden ? 'case_message_hide' : 'case_message_unhide',
        user_id: adminId,
        content: `管理员${input.hidden ? '隐藏' : '取消隐藏'}问题 #${input.caseId} 的对话 #${message.id}`
      }
    })
    return { changed: true as const }
  })
  if (typeof result === 'string') return result
  const row = await getCaseById(db, input.caseId)
  if (!row) return '问题不存在'
  const serialized = await serializeSummaryForViewer(
    db,
    row,
    adminId,
    adminRole,
    true
  )
  if (!serialized) return '问题不存在'
  return { case: serialized.summary, changed: result.changed }
}

/** The case a search names:「8」and「#8」both name case 8 (M03-9). */
const caseIdFromSearch = (search: string): number | null => {
  const numeric = Number(search.replace(/^#/, ''))
  return Number.isSafeInteger(numeric) && numeric > 0 && numeric <= CASE_ID_MAX
    ? numeric
    : null
}

/**
 * Admin search over the case center and the inbox (review item 25): case id,
 * kind code or Chinese label, game name, resource name, reporter name and
 * dialogue text. A resource target has no relation on the case row, so
 * resource names are matched first, only among the resources the cases in
 * `scope` point at: no match is cut off, and the id list grows with the case
 * queue instead of the resource table.
 */
const buildAdminCaseSearch = async (
  db: CaseDb,
  search: string,
  scope: Prisma.ops_caseWhereInput,
  field: CaseSearchField = 'all'
): Promise<Prisma.ops_caseWhereInput[]> => {
  const within = (wanted: CaseSearchField) => field === 'all' || field === wanted
  const contains = { contains: search, mode: 'insensitive' as const }
  const predicates: Prisma.ops_caseWhereInput[] = []
  const caseId = caseIdFromSearch(search)
  if (within('id') && caseId !== null) predicates.push({ id: caseId })
  if (within('kind')) {
    predicates.push({ kind: contains })
    const labelKinds = CASE_KINDS.filter((kind) =>
      CASE_KIND_LABELS[kind].includes(search)
    )
    if (labelKinds.length) predicates.push({ kind: { in: labelKinds } })
  }
  if (within('content')) {
    predicates.push({ messages: { some: { body: contains } } })
  }
  if (within('patch')) predicates.push({ patch: { name: contains } })
  if (within('reporter')) predicates.push({ reporter: { name: contains } })
  if (!within('resource')) return predicates
  const targets = await db.ops_case.findMany({
    where: { ...scope, target_type: 'resource' },
    select: { target_id: true },
    distinct: ['target_id']
  })
  const resources = targets.length
    ? await db.patch_resource.findMany({
        where: {
          id: { in: targets.map((target) => target.target_id) },
          name: contains
        },
        select: { id: true }
      })
    : []
  if (resources.length) {
    predicates.push({
      target_type: 'resource',
      target_id: { in: resources.map((resource) => resource.id) }
    })
  }
  return predicates
}

export const getAdminCases = async (
  input: AdminListInput,
  options: { db?: PrismaClient; now?: Date } = {}
): Promise<AdminCaseListResponse> => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  // Counting scope is the queue minus every status predicate — `statuses`,
  // `status` and `allStatuses` all stay out of it. Any of them would pin each
  // tab's count to that tab's own filter, and the default `unresolvedStatuses`
  // window would additionally hide the closed tabs the strip has to render.
  // `total` keeps the status predicate, so it stays the count of the rows this
  // response pages through.
  // `publisher` is the read-only oversight view (D22). It shares the list
  // shape but never feeds the inbox, which keeps its own staff-only query.
  const ownerType = input.ownerType ?? 'staff'
  const queueWhere: Prisma.ops_caseWhereInput = {
    owner_type: ownerType,
    ...(ownerType === 'publisher' && input.ownerId
      ? { owner_id: input.ownerId }
      : {}),
    ...(input.kind ? { kind: input.kind } : {})
  }
  const scopeWhere: Prisma.ops_caseWhereInput = {
    ...queueWhere,
    ...(input.search
      ? {
          OR: await buildAdminCaseSearch(
            db,
            input.search,
            queueWhere,
            input.searchField
          )
        }
      : {})
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
  // Searching 全部, the case the text names leads page 1 ahead of the
  // waiting order (M03-9); the paged rows skip it, so no page repeats it.
  const namedId =
    input.search && (input.searchField ?? 'all') === 'all'
      ? caseIdFromSearch(input.search)
      : null
  const named =
    namedId === null
      ? null
      : await db.ops_case.findFirst({
          where: { ...where, id: namedId },
          select: caseListSelect
        })
  const offset = (input.page - 1) * input.limit
  const [pagedRows, total, statusGroups] = await Promise.all([
    db.ops_case.findMany({
      where: named ? { ...where, id: { not: named.id } } : where,
      orderBy: [{ status_changed_at: 'asc' }, { id: 'asc' }],
      skip: named && input.page > 1 ? offset - 1 : offset,
      take: named && input.page === 1 ? input.limit - 1 : input.limit,
      select: caseListSelect
    }),
    db.ops_case.count({ where }),
    db.ops_case.groupBy({
      by: ['status'],
      where: scopeWhere,
      _count: { _all: true }
    })
  ])
  const rows = named && input.page === 1 ? [named, ...pagedRows] : pagedRows
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
        escalation_trigger: 'timeout',
        from_status: row.status,
        to_status: 'open',
        from_state_entered_at: row.status_changed_at.toISOString(),
        queue_entered_at: now.toISOString(),
        from_owner_type: row.owner_type,
        from_owner_id: row.owner_id
      },
      '发布者 7 天未处理，问题已提交给网站管理员处理。'
    )
    const notice = `${await describeCaseForNotice(tx, row)}的发布者 7 天未处理，已提交给网站管理员处理。`
    await notifyCaseUsers(
      tx,
      row.id,
      [row.owner_id ?? 0, row.reporter_id ?? 0],
      notice
    )
    await notifyCaseUsers(
      tx,
      row.id,
      await loadStaffIds(tx),
      notice,
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
      followerNotice: unresponsiveFollowerNotice(
        await describeCaseForNotice(tx, row)
      ),
      now
    })
  })
  if (!result.changed) return result
  const row = await getCaseById(db, caseId)
  if (row) await invalidateCasePatchCaches(db, [row.patch_id])
  return result
}

/**
 * One reminder 48 hours before either timeout (D22). The reminder is bound to
 * the state revision, so each waiting round reminds once and a state change
 * starts a new round. Writing `reminded_revision` never advances `revision`.
 */
export const remindCase = async (
  caseId: number,
  options: { now?: Date; db?: PrismaClient } = {}
) => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  return db.$transaction(async (tx) => {
    const row = await getCaseLock(tx, caseId)
    if (!row || row.owner_type !== 'publisher') return { changed: false }
    if (row.reminded_revision !== null && row.reminded_revision >= row.revision)
      return { changed: false }
    const entered = row.status_changed_at.getTime()
    const waitingOwner =
      (row.status === 'open' || row.status === 'waiting_owner') &&
      (CASE_PUBLISHER_TIMEOUT_KINDS as readonly string[]).includes(row.kind)
    const waitingReporter =
      row.status === 'waiting_reporter' &&
      row.reporter_id !== null &&
      (CASE_REPORTER_TIMEOUT_KINDS as readonly string[]).includes(row.kind)
    const deadline = waitingOwner
      ? entered + CASE_PUBLISHER_ESCALATION_AFTER_MS
      : waitingReporter
        ? entered + CASE_REPORTER_TIMEOUT_AFTER_MS
        : null
    if (
      deadline === null ||
      now.getTime() < deadline - CASE_REMINDER_LEAD_MS ||
      now.getTime() >= deadline
    ) {
      return { changed: false }
    }
    const updated = await tx.ops_case.updateMany({
      where: {
        id: row.id,
        status: row.status,
        revision: row.revision,
        OR: [
          { reminded_revision: null },
          { reminded_revision: { lt: row.revision } }
        ]
      },
      data: { reminded_revision: row.revision }
    })
    if (updated.count === 0) return { changed: false }
    const subject = await describeCaseForNotice(tx, row)
    if (waitingOwner && row.owner_id !== null) {
      await notifyCaseUsers(
        tx,
        row.id,
        [row.owner_id],
        `${subject}还有 2 天将提交给网站管理员处理，请尽快回复或结案。`
      )
    } else if (waitingReporter && row.reporter_id !== null) {
      await notifyCaseUsers(
        tx,
        row.id,
        [row.reporter_id],
        `${subject}的处理方在等你补充，还有 2 天将自动结案。`
      )
    }
    return { changed: true }
  })
}

/**
 * Public resource badges, one per open public case (D17: a resource may carry
 * both a description case and an interim link-failure case).
 */
export const getPublicResourceCaseBadges = async (
  resourceIds: number[],
  options: { db?: PrismaClient } = {}
) => {
  const db = options.db ?? prisma
  const result = new Map<number, PatchCaseSummary[]>()
  if (!resourceIds.length) return result
  const rows = await db.ops_case.findMany({
    where: {
      target_type: 'resource',
      target_id: { in: resourceIds },
      public: true,
      status: { in: unresolvedStatuses }
    },
    orderBy: [{ id: 'asc' }],
    select: {
      target_id: true,
      kind: true,
      owner_type: true,
      _count: { select: { subscribers: true } }
    }
  })
  for (const row of rows) {
    if (!isCaseOwnerType(row.owner_type) || !isCaseKind(row.kind)) continue
    const badges = result.get(row.target_id) ?? []
    badges.push({
      kind: row.kind,
      reportCount: row._count.subscribers,
      ownerType: row.owner_type
    })
    result.set(row.target_id, badges)
  }
  return result
}

/**
 * The inbox's case source: staff cases waiting on the handler, oldest first
 * (D23). A case waiting on its reporter stays in the case center.
 */
export const getAdminCaseInboxItems = async (
  input: { limit: number; search?: string },
  now = new Date(),
  db: PrismaClient = prisma
): Promise<{ items: CaseInboxItem[]; total: number }> => {
  const queueWhere: Prisma.ops_caseWhereInput = {
    owner_type: 'staff',
    status: { in: [...CASE_WAITING_HANDLER_STATUSES] }
  }
  const where: Prisma.ops_caseWhereInput = {
    ...queueWhere,
    ...(input.search
      ? { OR: await buildAdminCaseSearch(db, input.search, queueWhere) }
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
    // A shoutbox or user target carries no game name; only a missing target
    // is deleted.
    subtitle: summary.target.deleted
      ? '目标已删除'
      : (summary.target.patch?.name ??
        summary.target.label ??
        `${CASE_TARGET_TYPE_LABELS[summary.targetType]} #${summary.targetId}`),
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
