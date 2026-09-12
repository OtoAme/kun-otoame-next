import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '~/prisma/index'
import {
  SHOUTBOX_EDIT_WINDOW_MS,
  SHOUTBOX_AUTO_HIDE_REPORTER_THRESHOLD,
  SHOUTBOX_BLOCKED_KEYWORDS,
  SHOUTBOX_KEYWORD_REJECT_MESSAGE,
  containsShoutboxKeyword,
  SHOUTBOX_LEVELS,
  SHOUTBOX_MAX_PAGES,
  SHOUTBOX_MAX_VISIBLE_SLOTS,
  SHOUTBOX_OFFICIAL_DEFAULT_DURATION_MS,
  SHOUTBOX_PAGE_SIZE,
  SHOUTBOX_PRICE,
  SHOUTBOX_STATUSES,
  type ShoutboxLevel,
  type ShoutboxStatus
} from '~/constants/shoutbox'
import { MOEMOEPOINT_REASON } from '~/constants/moemoepoint'
import {
  MoemoepointInsufficientError,
  getCurrentBalance,
  refundMoemoepoint,
  spendMoemoepoint
} from '~/app/api/moemoepoint/service'
import { createMessage } from '~/app/api/utils/message'
import type {
  ShoutboxBannerResponse,
  AdminShoutboxListResponse,
  AdminShoutboxReviewItem,
  ShoutboxItem,
  ShoutboxListResponse,
  ShoutboxPatchSummary,
  ShoutboxProfileResponse,
  ShoutboxPublishResponse,
  ShoutboxPendingReport
} from '~/types/api/shoutbox'
import type {
  adminShoutboxCreateSchema,
  adminShoutboxListSchema,
  adminShoutboxUpdateSchema,
  shoutboxCreateSchema,
  shoutboxDeleteSchema,
  shoutboxListSchema,
  shoutboxProfileSchema,
  adminShoutboxModerateSchema,
  shoutboxReportSchema,
  shoutboxUpdateSchema
} from '~/validations/shoutbox'
import type { z } from 'zod'
import {
  invalidateShoutboxCaches,
  getShoutboxCached,
  getShoutboxCacheKey,
  getShoutboxBannerCached,
  getShoutboxBannerCacheKey,
  SHOUTBOX_LIST_CACHE_DURATION,
  SHOUTBOX_BANNER_CACHE_DURATION,
  SHOUTBOX_PATCH_CACHE_DURATION
} from './cache'
type ShoutboxCreateInput = z.infer<typeof shoutboxCreateSchema>
type ShoutboxUpdateInput = z.infer<typeof shoutboxUpdateSchema>
type ShoutboxDeleteInput = z.infer<typeof shoutboxDeleteSchema>
type AdminShoutboxCreateInput = z.infer<typeof adminShoutboxCreateSchema>
type AdminShoutboxListInput = z.infer<typeof adminShoutboxListSchema>
type AdminShoutboxUpdateInput = z.infer<typeof adminShoutboxUpdateSchema>
type AdminShoutboxModerateInput = z.infer<typeof adminShoutboxModerateSchema>
type ShoutboxReportInput = z.infer<typeof shoutboxReportSchema>
type ShoutboxListInput = z.infer<typeof shoutboxListSchema>
type ShoutboxProfileInput = z.infer<typeof shoutboxProfileSchema>
type DateLike = Date | string

const userSelect = {
  id: true,
  name: true,
  avatar: true
} satisfies Prisma.userSelect

const patchSelect = {
  id: true,
  unique_id: true,
  name: true,
  content_limit: true,
  tag: { select: { tag_id: true } }
} satisfies Prisma.patchSelect

type ShoutboxPatchRow = Prisma.patchGetPayload<{
  select: typeof patchSelect
}>

const shoutboxSelect = {
  id: true,
  user_id: true,
  request_id: true,
  content: true,
  link: true,
  official: true,
  level: true,
  status: true,
  cost: true,
  patch_id: true,
  effective_from: true,
  effective_to: true,
  edited_at: true,
  hidden_at: true,
  refunded_at: true,
  created: true,
  updated: true,
  user: { select: userSelect },
  patch: { select: patchSelect }
} satisfies Prisma.shoutboxSelect

type ShoutboxDbRow = Prisma.shoutboxGetPayload<{
  select: typeof shoutboxSelect
}>
type ShoutboxDateField =
  | 'effective_from'
  | 'effective_to'
  | 'edited_at'
  | 'hidden_at'
  | 'refunded_at'
  | 'created'
  | 'updated'
type ShoutboxRow = Omit<ShoutboxDbRow, ShoutboxDateField> & {
  effective_from: DateLike | null
  effective_to: DateLike | null
  edited_at: DateLike | null
  hidden_at: DateLike | null
  refunded_at: DateLike | null
  created: DateLike
  updated: DateLike
}

type ShoutboxCachePayload = {
  pinned: ShoutboxRow | null
  shoutboxes: ShoutboxRow[]
  page: number
  totalPages: number
  validUntil: string
}

const isShoutboxStatus = (value: number): value is ShoutboxStatus =>
  (SHOUTBOX_STATUSES as readonly number[]).includes(value)

const isShoutboxLevel = (value: string): value is ShoutboxLevel =>
  (SHOUTBOX_LEVELS as readonly string[]).includes(value)

const asDate = (value: DateLike | null | undefined) => {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

const toIso = (value: DateLike | null | undefined) =>
  asDate(value)?.toISOString() ?? null

const normalizeShoutboxRow = (row: ShoutboxRow): ShoutboxRow => ({
  ...row,
  effective_from: asDate(row.effective_from),
  effective_to: asDate(row.effective_to),
  edited_at: asDate(row.edited_at),
  hidden_at: asDate(row.hidden_at),
  refunded_at: asDate(row.refunded_at),
  created: asDate(row.created) ?? new Date(0),
  updated: asDate(row.updated) ?? new Date(0)
})

const normalizeShoutboxPayload = (
  payload: ShoutboxCachePayload
): ShoutboxCachePayload => ({
  ...payload,
  pinned: payload.pinned ? normalizeShoutboxRow(payload.pinned) : null,
  shoutboxes: payload.shoutboxes.map(normalizeShoutboxRow),
  validUntil: toIso(payload.validUntil) ?? new Date(0).toISOString()
})

const isUniqueConstraintError = (error: unknown) =>
  (typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ((error as { code?: unknown }).code === 'P2002' ||
      (error as { code?: unknown }).code === '23505')) ||
  String(error).includes('23505')

const isRetryableTransactionError = (error: unknown) => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2034'
  ) {
    return true
  }

  const text = String(error)
  return text.includes('40001') || text.includes('TransactionWriteConflict')
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

const runWithTransactionRetry = async <T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  db: PrismaClient = prisma
) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.$transaction(fn)
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt >= 2) {
        throw error
      }
      await sleep((attempt + 1) * 50)
    }
  }
}

const normalizeContent = (content: string) => content.trim()

type ShoutboxKeywordList = readonly string[]

const rejectBlockedContent = (
  content: string,
  keywords?: ShoutboxKeywordList
) =>
  containsShoutboxKeyword(content, keywords ?? SHOUTBOX_BLOCKED_KEYWORDS)
    ? SHOUTBOX_KEYWORD_REJECT_MESSAGE
    : null

type ShoutboxLockRow = {
  id: number
  user_id: number
  content: string
  link: string
  official: boolean
  level: string
  status: number
  cost: number
  patch_id: number | null
  effective_from: Date | null
  effective_to: Date | null
  hidden_at: Date | null
  refunded_at: Date | null
}

const shoutboxLockSelect = {
  id: true,
  user_id: true,
  content: true,
  link: true,
  official: true,
  level: true,
  status: true,
  cost: true,
  patch_id: true,
  effective_from: true,
  effective_to: true,
  hidden_at: true,
  refunded_at: true
} satisfies Prisma.shoutboxSelect

/**
 * Prisma does not expose a row-lock option for findUnique. Report creation
 * and moderation both use this helper so the duplicate-report check, threshold
 * count and state CAS observe one serialized target state.
 */
const lockShoutbox = async (
  tx: Prisma.TransactionClient,
  shoutboxId: number
): Promise<ShoutboxLockRow | null> => {
  if (typeof tx.$queryRaw === 'function') {
    const rows = await tx.$queryRaw<ShoutboxLockRow[]>(Prisma.sql`
      SELECT id, user_id, content, link, official, level, status, cost,
             patch_id, effective_from, effective_to, hidden_at, refunded_at
      FROM shoutbox
      WHERE id = ${shoutboxId}
      FOR UPDATE
    `)
    return rows[0] ?? null
  }

  const row = await tx.shoutbox.findUnique({
    where: { id: shoutboxId },
    select: shoutboxLockSelect
  })
  return row as ShoutboxLockRow | null
}

const publicBaseWhere = (now: Date): Prisma.shoutboxWhereInput => ({
  status: 0,
  OR: [{ official: false }, { official: true, effective_from: { lte: now } }]
})

const effectiveOfficialWhere = (now: Date): Prisma.shoutboxWhereInput => ({
  official: true,
  status: 0,
  effective_from: { lte: now },
  effective_to: { gt: now }
})

const importantOfficialWhere = (now: Date): Prisma.shoutboxWhereInput => ({
  ...effectiveOfficialWhere(now),
  level: 'important'
})

const toPatchSummary = (
  patch: ShoutboxPatchRow
): ShoutboxPatchSummary | null =>
  patch
    ? {
        id: patch.id,
        uniqueId: patch.unique_id,
        name: patch.name,
        contentLimit: patch.content_limit
      }
    : null

const visiblePatch = (
  patch: ShoutboxPatchRow,
  visibilityWhere: Prisma.patchWhereInput
) => {
  const contentLimit = visibilityWhere.content_limit
  if (contentLimit === 'sfw' && patch.content_limit !== 'sfw') {
    return false
  }

  const not = visibilityWhere.NOT
  const blockedIds = (() => {
    if (!not || Array.isArray(not) || typeof not !== 'object') return undefined
    const notRecord = not as Record<string, unknown>
    const tag = notRecord.tag
    if (!tag || typeof tag !== 'object' || Array.isArray(tag)) return undefined
    const some = (tag as Record<string, unknown>).some
    if (!some || typeof some !== 'object' || Array.isArray(some))
      return undefined
    const tagId = (some as Record<string, unknown>).tag_id
    if (!tagId || typeof tagId !== 'object' || Array.isArray(tagId))
      return undefined
    const ids = (tagId as Record<string, unknown>).in
    return Array.isArray(ids) ? ids : undefined
  })()

  if (Array.isArray(blockedIds)) {
    const blocked = new Set(
      blockedIds.filter((id): id is number => typeof id === 'number')
    )
    if (patch.tag.some(({ tag_id }) => blocked.has(tag_id))) return false
  }

  return true
}

const serializeShoutbox = (
  row: ShoutboxRow,
  visibilityWhere: Prisma.patchWhereInput = {}
): ShoutboxItem => ({
  id: row.id,
  user: row.user,
  content: row.content,
  link: row.link,
  official: row.official,
  level: isShoutboxLevel(row.level) ? row.level : 'normal',
  status: isShoutboxStatus(row.status) ? row.status : 3,
  cost: row.cost,
  patch:
    row.patch && visiblePatch(row.patch, visibilityWhere)
      ? toPatchSummary(row.patch)
      : null,
  effectiveFrom: toIso(row.effective_from),
  effectiveTo: toIso(row.effective_to),
  editedAt: toIso(row.edited_at),
  hiddenAt: toIso(row.hidden_at),
  refundedAt: toIso(row.refunded_at),
  created: toIso(row.created) ?? new Date(0).toISOString(),
  updated: toIso(row.updated) ?? new Date(0).toISOString()
})

const serializePayload = (
  payload: ShoutboxCachePayload,
  visibilityWhere: Prisma.patchWhereInput
): ShoutboxListResponse => ({
  pinned: payload.pinned
    ? serializeShoutbox(payload.pinned, visibilityWhere)
    : null,
  shoutboxes: payload.shoutboxes.map((row) =>
    serializeShoutbox(row, visibilityWhere)
  ),
  page: payload.page,
  totalPages: payload.totalPages,
  validUntil: payload.validUntil
})

const minFutureDate = (dates: Array<DateLike | null>, now: Date) => {
  const future = dates
    .filter(
      (date): date is DateLike =>
        date !== null && (asDate(date)?.getTime() ?? 0) > now.getTime()
    )
    .sort((a, b) => (asDate(a)?.getTime() ?? 0) - (asDate(b)?.getTime() ?? 0))
  return future[0] ?? null
}

const validUntilFor = (
  now: Date,
  durationSeconds: number,
  boundaries: Array<DateLike | null>
) => {
  const max = new Date(now.getTime() + durationSeconds * 1000)
  const boundary = minFutureDate(boundaries, now)
  const boundaryDate = asDate(boundary)
  const value =
    boundaryDate && boundaryDate.getTime() < max.getTime() ? boundaryDate : max
  return value.toISOString()
}

export const isShoutboxPayloadValid = (
  payload: Pick<ShoutboxCachePayload, 'validUntil'>,
  now = new Date()
) => {
  const validUntil = new Date(payload.validUntil)
  return (
    Number.isFinite(validUntil.getTime()) &&
    validUntil.getTime() > now.getTime()
  )
}

export const getShoutboxPageWindow = (page: number, hasPinned: boolean) => {
  if (hasPinned && page === 1) return { skip: 0, take: SHOUTBOX_PAGE_SIZE - 1 }
  return {
    skip: hasPinned
      ? (page - 1) * SHOUTBOX_PAGE_SIZE - 1
      : (page - 1) * SHOUTBOX_PAGE_SIZE,
    take: SHOUTBOX_PAGE_SIZE
  }
}

export const getShoutboxPageCount = (visibleCount: number) =>
  Math.min(
    SHOUTBOX_MAX_PAGES,
    Math.ceil(
      Math.min(Math.max(visibleCount, 0), SHOUTBOX_MAX_VISIBLE_SLOTS) /
        SHOUTBOX_PAGE_SIZE
    )
  )

const getActiveOfficialBoundaries = async (now: Date, db: PrismaClient) => {
  const [pinned, banner, nextOfficial] = await Promise.all([
    db.shoutbox.findFirst({
      where: effectiveOfficialWhere(now),
      orderBy: [{ created: 'desc' }, { id: 'desc' }],
      select: { id: true, effective_to: true }
    }),
    db.shoutbox.findFirst({
      where: importantOfficialWhere(now),
      orderBy: [{ created: 'desc' }, { id: 'desc' }],
      select: { effective_to: true }
    }),
    db.shoutbox.findFirst({
      where: {
        official: true,
        status: 0,
        effective_from: { gt: now }
      },
      orderBy: { effective_from: 'asc' },
      select: { effective_from: true }
    })
  ])
  return {
    pinned,
    boundaries: [
      pinned?.effective_to ?? null,
      banner?.effective_to ?? null,
      nextOfficial?.effective_from ?? null
    ]
  }
}

const buildGeneralPayload = async (
  input: ShoutboxListInput,
  now: Date,
  db: PrismaClient
): Promise<ShoutboxCachePayload> => {
  const { pinned, boundaries } = await getActiveOfficialBoundaries(now, db)
  const pinnedRow = pinned
    ? await db.shoutbox.findUnique({
        where: {
          ...effectiveOfficialWhere(now),
          id: pinned.id
        },
        select: shoutboxSelect
      })
    : null
  const baseWhere = publicBaseWhere(now)
  const timelineWhere: Prisma.shoutboxWhereInput = pinnedRow
    ? { ...baseWhere, id: { not: pinnedRow.id } }
    : baseWhere
  const visibleCount = await db.shoutbox.count({ where: baseWhere })
  const totalPages = getShoutboxPageCount(visibleCount)
  const window = getShoutboxPageWindow(input.page, Boolean(pinnedRow))
  const rows =
    input.page <= totalPages
      ? await db.shoutbox.findMany({
          where: timelineWhere,
          orderBy: [{ created: 'desc' }, { id: 'desc' }],
          skip: window.skip,
          take: window.take,
          select: shoutboxSelect
        })
      : []
  return {
    pinned: input.page === 1 ? pinnedRow : null,
    shoutboxes: rows,
    page: input.page,
    totalPages,
    validUntil: validUntilFor(now, SHOUTBOX_LIST_CACHE_DURATION, boundaries)
  }
}

const getPatchId = async (uniqueId: string, db: PrismaClient) => {
  const patch = await db.patch.findUnique({
    where: { unique_id: uniqueId },
    select: { id: true, status: true }
  })
  if (!patch || patch.status !== 0) {
    return null
  }
  return patch.id
}

type ShoutboxPatchPageRow = {
  id: number | null
  total_count: number
  created: DateLike | null
  expiry_at: DateLike | null
  retention_expiry_at: DateLike | null
  in_timeline_range: boolean | null
}

const getBoundedPatchPage = async (
  patchId: number,
  pinnedId: number | null,
  input: ShoutboxListInput & { patch: string },
  now: Date,
  db: PrismaClient
) => {
  const offset = SHOUTBOX_MAX_VISIBLE_SLOTS - 1 - (pinnedId ? 1 : 0)
  const start = (input.page - 1) * SHOUTBOX_PAGE_SIZE
  const pinnedValue =
    pinnedId === null
      ? Prisma.sql`NULL::integer`
      : Prisma.sql`${pinnedId}::integer`
  return db.$queryRaw<ShoutboxPatchPageRow[]>(Prisma.sql`
    WITH timeline AS (
      SELECT s.id, s.created
      FROM shoutbox s
      WHERE s.status = 0
        AND (s.official = false OR s.effective_from <= ${now})
        AND (${pinnedValue} IS NULL OR s.id <> ${pinnedValue})
      ORDER BY s.created DESC, s.id DESC
      OFFSET ${offset}
      LIMIT 1
    ), patch_candidates AS (
      SELECT
        s.id,
        s.created,
        (
          (
            (s.created AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')
            + INTERVAL '3 months'
          ) AT TIME ZONE 'Asia/Shanghai'
        ) AS expiry_at,
        CASE
          WHEN ${pinnedValue} IS NOT NULL AND s.id = ${pinnedValue} THEN TRUE
          WHEN timeline.id IS NULL THEN TRUE
          WHEN s.created > timeline.created
            OR (s.created = timeline.created AND s.id >= timeline.id)
            THEN TRUE
          ELSE FALSE
        END AS in_timeline_range
      FROM shoutbox s
      LEFT JOIN timeline ON TRUE
      WHERE s.status = 0
        AND (s.official = false OR s.effective_from <= ${now})
        AND s.patch_id = ${patchId}
    ), visible AS (
      SELECT *
      FROM patch_candidates
      WHERE in_timeline_range = TRUE
        OR expiry_at > ${now}
    ), retention_boundaries AS (
      SELECT MIN(expiry_at) AS retention_expiry_at
      FROM visible
      WHERE in_timeline_range = FALSE
    ), totals AS (
      SELECT COUNT(*)::integer AS total_count
      FROM visible
    ), page_rows AS (
      SELECT id, created, expiry_at, in_timeline_range
      FROM visible
      ORDER BY created DESC, id DESC
      OFFSET ${start}
      LIMIT ${SHOUTBOX_PAGE_SIZE}
    )
    SELECT
      page_rows.id,
      totals.total_count,
      page_rows.created,
      page_rows.expiry_at,
      retention_boundaries.retention_expiry_at,
      page_rows.in_timeline_range
    FROM totals
    CROSS JOIN retention_boundaries
    LEFT JOIN page_rows ON TRUE
    ORDER BY page_rows.created DESC NULLS LAST, page_rows.id DESC NULLS LAST
  `)
}

const buildPatchPayload = async (
  input: ShoutboxListInput & { patch: string },
  now: Date,
  db: PrismaClient
): Promise<ShoutboxCachePayload> => {
  const patchId = await getPatchId(input.patch, db)
  if (!patchId) {
    return {
      pinned: null,
      shoutboxes: [],
      page: input.page,
      totalPages: 0,
      validUntil: validUntilFor(now, SHOUTBOX_PATCH_CACHE_DURATION, [])
    }
  }

  const { pinned, boundaries } = await getActiveOfficialBoundaries(now, db)
  const pinnedId = pinned?.id ?? null
  const queryRows = await getBoundedPatchPage(patchId, pinnedId, input, now, db)
  const totalCount = Number(queryRows[0]?.total_count ?? 0)
  const pageRows = queryRows.filter(
    (queryRow): queryRow is ShoutboxPatchPageRow & { id: number } =>
      typeof queryRow.id === 'number'
  )
  const ids = pageRows.map((queryRow) => queryRow.id)
  const detailRows = ids.length
    ? await db.shoutbox.findMany({
        where: {
          ...publicBaseWhere(now),
          patch_id: patchId,
          id: { in: ids }
        },
        select: shoutboxSelect
      })
    : []
  const rowsById = new Map(detailRows.map((row) => [row.id, row]))
  const hydratedRows = ids.flatMap((id) => {
    const row = rowsById.get(id)
    return row ? [row] : []
  })
  const expiryBoundaries = [asDate(queryRows[0]?.retention_expiry_at)]

  return {
    pinned: null,
    shoutboxes: hydratedRows,
    page: input.page,
    totalPages: Math.ceil(totalCount / SHOUTBOX_PAGE_SIZE),
    validUntil: validUntilFor(now, SHOUTBOX_PATCH_CACHE_DURATION, [
      ...boundaries,
      ...expiryBoundaries
    ])
  }
}

const getPayload = async (
  input: ShoutboxListInput,
  now: Date,
  db: PrismaClient
) => {
  if (input.patch) {
    return buildPatchPayload({ ...input, patch: input.patch }, now, db)
  }
  return buildGeneralPayload(input, now, db)
}

const emptyListPayload = (
  input: ShoutboxListInput,
  now: Date
): ShoutboxCachePayload => ({
  pinned: null,
  shoutboxes: [],
  page: input.page,
  totalPages: 0,
  // A failed authoritative refresh must never be advertised as cacheable.
  validUntil: now.toISOString()
})

export const getShoutboxList = async (
  input: ShoutboxListInput,
  options: {
    now?: Date
    visibilityWhere?: Prisma.patchWhereInput
    db?: PrismaClient
    useCache?: boolean
  } = {}
): Promise<ShoutboxListResponse> => {
  const initialNow = options.now ?? new Date()
  const getNow = () => options.now ?? new Date()
  let queryNow = initialNow
  const visibilityWhere = options.visibilityWhere ?? {}
  const db = options.db ?? prisma
  const cacheKey = input.patch
    ? getShoutboxCacheKey(input.patch, input.page)
    : getShoutboxCacheKey(null, input.page)
  const fetcher = () => getPayload(input, queryNow, db)

  const reloadAtCompletion = async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      queryNow = getNow()
      try {
        const refreshed = normalizeShoutboxPayload(await fetcher())
        const completedNow = getNow()
        if (isShoutboxPayloadValid(refreshed, completedNow)) {
          return refreshed
        }
      } catch (error) {
        console.error(
          '[Shoutbox] Failed to refresh expired list payload:',
          error
        )
        break
      }
    }
    return emptyListPayload(input, getNow())
  }

  let payload: ShoutboxCachePayload
  try {
    if (options.useCache === false) {
      payload = normalizeShoutboxPayload(await fetcher())
      if (!isShoutboxPayloadValid(payload, getNow())) {
        payload = await reloadAtCompletion()
      }
    } else {
      payload = normalizeShoutboxPayload(
        await getShoutboxCached(
          cacheKey,
          fetcher,
          input.patch
            ? SHOUTBOX_PATCH_CACHE_DURATION
            : SHOUTBOX_LIST_CACHE_DURATION,
          getNow
        )
      )
      if (!isShoutboxPayloadValid(payload, getNow())) {
        payload = await reloadAtCompletion()
      }
    }
  } catch (error) {
    console.error('[Shoutbox] Failed to load list payload:', error)
    payload = emptyListPayload(input, getNow())
  }
  return serializePayload(payload, visibilityWhere)
}

export const getShoutboxBanner = async (
  options: {
    now?: Date
    visibilityWhere?: Prisma.patchWhereInput
    db?: PrismaClient
    useCache?: boolean
  } = {}
): Promise<ShoutboxBannerResponse> => {
  const initialNow = options.now ?? new Date()
  const getNow = () => options.now ?? new Date()
  let queryNow = initialNow
  const visibilityWhere = options.visibilityWhere ?? {}
  const db = options.db ?? prisma
  const fetcher = async (): Promise<ShoutboxBannerResponse> => {
    const [row, nextImportant] = await Promise.all([
      db.shoutbox.findFirst({
        where: importantOfficialWhere(queryNow),
        orderBy: [{ created: 'desc' }, { id: 'desc' }],
        select: shoutboxSelect
      }),
      db.shoutbox.findFirst({
        where: {
          official: true,
          level: 'important',
          status: 0,
          effective_from: { gt: queryNow }
        },
        orderBy: { effective_from: 'asc' },
        select: { effective_from: true }
      })
    ])
    return {
      banner: row ? serializeShoutbox(row, visibilityWhere) : null,
      validUntil: validUntilFor(queryNow, SHOUTBOX_BANNER_CACHE_DURATION, [
        row?.effective_to ?? null,
        nextImportant?.effective_from ?? null
      ])
    }
  }
  const reloadAtCompletion = async (): Promise<ShoutboxBannerResponse> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      queryNow = getNow()
      try {
        const refreshed = await fetcher()
        const completedNow = getNow()
        if (isShoutboxPayloadValid(refreshed, completedNow)) {
          return refreshed
        }
      } catch (error) {
        console.error('[Shoutbox] Failed to refresh expired banner:', error)
        break
      }
    }
    return {
      banner: null,
      validUntil: getNow().toISOString()
    }
  }

  try {
    if (options.useCache === false) {
      const direct = await fetcher()
      if (isShoutboxPayloadValid(direct, getNow())) return direct
      return reloadAtCompletion()
    }
    const cached = await getShoutboxBannerCached(
      getShoutboxBannerCacheKey(),
      fetcher,
      SHOUTBOX_BANNER_CACHE_DURATION,
      getNow
    )
    if (!isShoutboxPayloadValid(cached, getNow())) {
      return reloadAtCompletion()
    }
    return cached
  } catch (error) {
    console.error('[Shoutbox] Failed to load banner payload:', error)
    return {
      banner: null,
      validUntil: getNow().toISOString()
    }
  }
}

const getExistingPublish = async (
  userId: number,
  requestId: string,
  db: PrismaClient
) =>
  db.shoutbox.findUnique({
    where: { user_id_request_id: { user_id: userId, request_id: requestId } },
    select: shoutboxSelect
  })

const serializeNormalPublishReplay = async (
  row: ShoutboxRow,
  userId: number,
  db: PrismaClient
) => {
  const balance = await getCurrentBalance(db, userId)
  return {
    ...serializeShoutbox(row),
    moemoepointBalance: balance
  } satisfies ShoutboxPublishResponse
}

export const createShoutbox = async (
  input: ShoutboxCreateInput,
  userId: number,
  options: {
    now?: Date
    db?: PrismaClient
    keywords?: ShoutboxKeywordList
  } = {}
) => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const content = normalizeContent(input.content)

  // This check deliberately precedes every read/write involved in publish
  // idempotency, patch validation and accounting. A rejected word must leave
  // no database or ledger trace, including on a malformed retry.
  const blocked = rejectBlockedContent(content, options.keywords)
  if (blocked) return blocked

  const existingBeforeValidation = await getExistingPublish(
    userId,
    input.requestId,
    db
  )
  if (existingBeforeValidation) {
    if (existingBeforeValidation.official) return '该请求标识已用于官方消息'
    return serializeNormalPublishReplay(existingBeforeValidation, userId, db)
  }

  if (input.patchId !== undefined) {
    const patch = await db.patch.findUnique({
      where: { id: input.patchId },
      select: { id: true, status: true }
    })
    if (!patch || patch.status !== 0) return 'OtomeGame 不存在或不可用'
  }

  const create = async (tx: Prisma.TransactionClient) => {
    const row = await tx.shoutbox.create({
      data: {
        user_id: userId,
        request_id: input.requestId,
        content,
        patch_id: input.patchId,
        cost: SHOUTBOX_PRICE,
        official: false,
        level: 'normal',
        status: 0,
        link: ''
      },
      select: shoutboxSelect
    })
    const pointChange = await spendMoemoepoint(tx, {
      userId,
      amount: SHOUTBOX_PRICE,
      requiredAvailable: SHOUTBOX_PRICE,
      reasonCode: MOEMOEPOINT_REASON.shoutboxPublish.code,
      reason: MOEMOEPOINT_REASON.shoutboxPublish.text,
      referenceType: 'shoutbox',
      referenceId: row.id,
      link: `/shoutbox?shoutbox=${row.id}`,
      idempotencyKey: `shoutbox:publish:${userId}:${input.requestId}`
    })
    return { row, balance: pointChange.balance }
  }

  try {
    const result = await runWithTransactionRetry(create, db)
    await invalidateShoutboxCaches()
    return {
      ...serializeShoutbox(result.row),
      moemoepointBalance: result.balance
    } satisfies ShoutboxPublishResponse
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    const existing = await getExistingPublish(userId, input.requestId, db)
    if (!existing) throw error
    if (existing.official) return '该请求标识已用于官方消息'
    return serializeNormalPublishReplay(existing, userId, db)
  }
}

export const updateShoutbox = async (
  input: ShoutboxUpdateInput,
  userId: number,
  options: {
    now?: Date
    db?: PrismaClient
    keywords?: ShoutboxKeywordList
  } = {}
) => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const content = normalizeContent(input.content)
  const blocked = rejectBlockedContent(content, options.keywords)
  if (blocked) return blocked
  const updated = await db.shoutbox.updateMany({
    where: {
      id: input.shoutboxId,
      user_id: userId,
      official: false,
      status: 0,
      edited_at: null,
      created: { gt: new Date(now.getTime() - SHOUTBOX_EDIT_WINDOW_MS) }
    },
    data: { content, edited_at: now }
  })
  if (updated.count === 0) {
    const existing = await db.shoutbox.findUnique({
      where: { id: input.shoutboxId },
      select: {
        user_id: true,
        official: true,
        status: true,
        edited_at: true,
        created: true
      }
    })
    if (!existing) return '小喇叭不存在'
    if (existing.user_id !== userId) return '只能编辑自己发布的小喇叭'
    if (existing.official) return '官方小喇叭不能通过此接口编辑'
    if (existing.status !== 0) return '当前小喇叭状态不能编辑'
    if (existing.edited_at) return '每条小喇叭只能编辑一次'
    return '小喇叭发布已超过 5 分钟，不能编辑'
  }
  const row = await db.shoutbox.findUnique({
    where: { id: input.shoutboxId },
    select: shoutboxSelect
  })
  await invalidateShoutboxCaches()
  return row ? serializeShoutbox(row) : {}
}

export const deleteShoutbox = async (
  input: ShoutboxDeleteInput,
  userId: number,
  options: { db?: PrismaClient } = {}
) => {
  const db = options.db ?? prisma
  const deleted = await db.shoutbox.updateMany({
    where: {
      id: input.shoutboxId,
      user_id: userId,
      official: false,
      status: { in: [0, 2] }
    },
    data: { status: 1 }
  })
  if (deleted.count === 0) {
    const existing = await db.shoutbox.findUnique({
      where: { id: input.shoutboxId },
      select: { user_id: true, official: true, status: true }
    })
    if (!existing) return '小喇叭不存在'
    if (existing.user_id !== userId) return '只能删除自己发布的小喇叭'
    if (existing.official) return '官方小喇叭不能自删'
    return '当前小喇叭状态不能删除'
  }
  await invalidateShoutboxCaches()
  return {}
}

const assertOfficialInput = (
  level: string | undefined,
  effectiveFrom: Date | undefined,
  effectiveTo: Date | undefined,
  now: Date
) => {
  if (level !== undefined && !isShoutboxLevel(level)) return '官方级别不合法'
  if (
    effectiveFrom &&
    effectiveTo &&
    effectiveTo.getTime() <= effectiveFrom.getTime()
  ) {
    return '官方生效结束时间必须晚于开始时间'
  }
  if (
    effectiveTo &&
    effectiveTo.getTime() <= now.getTime() &&
    effectiveFrom === undefined
  ) {
    return '官方生效区间不能早于当前时间'
  }
  return null
}

export const createOfficialShoutbox = async (
  input: AdminShoutboxCreateInput,
  adminId: number,
  options: {
    now?: Date
    db?: PrismaClient
    keywords?: ShoutboxKeywordList
    adminRole?: number
  } = {}
) => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  if (options.adminRole !== undefined && options.adminRole < 3) {
    return '本页面仅管理员可访问'
  }
  const blocked = rejectBlockedContent(
    normalizeContent(input.content),
    options.keywords
  )
  if (blocked) return blocked
  const existingBeforeValidation = await getExistingPublish(
    adminId,
    input.requestId,
    db
  )
  if (existingBeforeValidation) {
    if (!existingBeforeValidation.official) return '该请求标识已用于普通小喇叭'
    return serializeShoutbox(existingBeforeValidation)
  }
  const issue = assertOfficialInput(
    input.level,
    input.effectiveFrom,
    input.effectiveTo,
    now
  )
  if (issue) return issue
  const effectiveFrom = input.effectiveFrom ?? now
  const effectiveTo =
    input.effectiveTo ??
    new Date(effectiveFrom.getTime() + SHOUTBOX_OFFICIAL_DEFAULT_DURATION_MS)
  if (effectiveTo.getTime() <= effectiveFrom.getTime())
    return '官方生效结束时间必须晚于开始时间'

  try {
    const row = await runWithTransactionRetry(async (tx) => {
      const created = await tx.shoutbox.create({
        data: {
          user_id: adminId,
          request_id: input.requestId,
          content: normalizeContent(input.content),
          link: input.link,
          official: true,
          level: input.level ?? 'normal',
          status: 0,
          cost: 0,
          effective_from: effectiveFrom,
          effective_to: effectiveTo
        },
        select: shoutboxSelect
      })
      await tx.admin_log.create({
        data: {
          type: 'shoutbox_official_publish',
          user_id: adminId,
          content: `管理员发布了官方小喇叭 #${created.id}`
        }
      })
      return created
    }, db)
    await invalidateShoutboxCaches()
    return serializeShoutbox(row)
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    const existing = await getExistingPublish(adminId, input.requestId, db)
    if (!existing) throw error
    if (!existing.official) return '该请求标识已用于普通小喇叭'
    return serializeShoutbox(existing)
  }
}

export const updateOfficialShoutbox = async (
  input: AdminShoutboxUpdateInput,
  adminId: number,
  options: {
    now?: Date
    db?: PrismaClient
    adminRole?: number
    keywords?: ShoutboxKeywordList
  } = {}
) => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  if (options.adminRole !== undefined && options.adminRole < 3) {
    return '本页面仅管理员可访问'
  }
  if (input.content !== undefined) {
    const blocked = rejectBlockedContent(input.content, options.keywords)
    if (blocked) return blocked
  }
  const hasFields =
    input.content !== undefined ||
    input.level !== undefined ||
    input.effectiveFrom !== undefined ||
    input.effectiveTo !== undefined ||
    input.link !== undefined
  if (input.action && hasFields) return '结束或撤回不能同时修改其他字段'
  if (!input.action && !hasFields) return '请提供要更新的内容'

  const result = await runWithTransactionRetry(async (tx) => {
    const existing = (await tx.shoutbox.findUnique({
      where: { id: input.shoutboxId },
      select: shoutboxLockSelect
    })) as ShoutboxLockRow | null
    if (!existing) return '官方小喇叭不存在'
    if (!existing.official) return '只能编辑官方小喇叭'

    if (input.action === 'cancel') {
      const from = asDate(existing.effective_from)
      const to = asDate(existing.effective_to)
      if (
        existing.status !== 0 ||
        !from ||
        !to ||
        to.getTime() <= now.getTime()
      ) {
        return '已过期的官方小喇叭不能撤回'
      }
      const updated = await tx.shoutbox.updateMany({
        where: {
          id: input.shoutboxId,
          official: true,
          status: 0,
          effective_to: { gt: now }
        },
        data: { status: 3 }
      })
      if (updated.count === 0) return '官方小喇叭当前不能撤回'
      await tx.admin_log.create({
        data: {
          type: 'shoutbox_official_update',
          user_id: adminId,
          content: `管理员撤回官方小喇叭 #${input.shoutboxId}`
        }
      })
      return {}
    }

    if (input.action === 'end') {
      const from = asDate(existing.effective_from)
      const to = asDate(existing.effective_to)
      if (
        existing.status !== 0 ||
        !from ||
        !to ||
        from.getTime() >= now.getTime() ||
        to.getTime() <= now.getTime()
      ) {
        return '只有生效中的官方小喇叭可以提前结束'
      }
      const updated = await tx.shoutbox.updateMany({
        where: {
          id: input.shoutboxId,
          official: true,
          status: 0,
          effective_from: { lt: now },
          effective_to: { gt: now }
        },
        data: { effective_to: now }
      })
      if (updated.count === 0) return '官方小喇叭当前不能提前结束'
      await tx.admin_log.create({
        data: {
          type: 'shoutbox_official_update',
          user_id: adminId,
          content: `管理员结束官方小喇叭 #${input.shoutboxId}`
        }
      })
      return {}
    }

    const issue = assertOfficialInput(
      input.level,
      input.effectiveFrom,
      input.effectiveTo,
      now
    )
    if (issue) return issue
    const from = asDate(input.effectiveFrom ?? existing.effective_from)
    const to = asDate(input.effectiveTo ?? existing.effective_to)
    if (!from || !to || to.getTime() <= from.getTime()) {
      return '官方生效结束时间必须晚于开始时间'
    }
    const data = {
      ...(input.content === undefined
        ? {}
        : { content: normalizeContent(input.content) }),
      ...(input.level === undefined ? {} : { level: input.level }),
      ...(input.effectiveFrom === undefined ? {} : { effective_from: from }),
      ...(input.effectiveTo === undefined ? {} : { effective_to: to }),
      ...(input.link === undefined ? {} : { link: input.link })
    }
    const updated = await tx.shoutbox.updateMany({
      where: { id: input.shoutboxId, official: true },
      data
    })
    if (updated.count === 0) return '官方小喇叭更新失败'
    await tx.admin_log.create({
      data: {
        type: 'shoutbox_official_update',
        user_id: adminId,
        content: `管理员更新官方小喇叭 #${input.shoutboxId}`
      }
    })
    return {}
  }, db)

  if (typeof result === 'object' && result !== null) {
    await invalidateShoutboxCaches()
  }
  return result
}

const shoutboxReportWhere = (shoutboxId: number) =>
  ({
    target_type: 'shoutbox',
    shoutbox_id: shoutboxId,
    status: 0
  }) as const

type PendingShoutboxReport = {
  id: number
  sender_id: number
  reason?: string
}

const getPendingShoutboxReports = async (
  tx: Prisma.TransactionClient,
  shoutboxId: number
) => {
  const rows = await tx.patch_report.findMany({
    where: shoutboxReportWhere(shoutboxId),
    select: { id: true, sender_id: true, reason: true },
    orderBy: [{ created: 'asc' }, { id: 'asc' }]
  })
  return (Array.isArray(rows) ? rows : []) as PendingShoutboxReport[]
}

const shoutboxLink = (shoutboxId: number) => `/shoutbox?shoutbox=${shoutboxId}`

const createShoutboxAuthorNotice = (
  action: 'hide' | 'remove' | 'restore',
  shoutboxId: number
) => {
  const content =
    action === 'hide'
      ? '您的小喇叭因收到多名用户举报，已暂时隐藏，等待站方复核。'
      : action === 'remove'
        ? '您的小喇叭已被站方认定违规并删除。'
        : '您的小喇叭已被站方恢复公开显示。'
  return {
    type: 'report' as const,
    content,
    recipient_id: undefined,
    link: shoutboxLink(shoutboxId)
  }
}

const createShoutboxReporterNotice = (
  accepted: boolean,
  reason: string,
  reply: string,
  shoutboxId: number
) => ({
  type: 'report' as const,
  content: `${accepted ? '您的小喇叭举报已受理' : '您的小喇叭举报已驳回'}!\n\n举报原因: ${reason.slice(0, 200)}\n处理回复: ${reply}`,
  link: shoutboxLink(shoutboxId)
})

const normalizeModerationDecision = (
  input: AdminShoutboxModerateInput
): 'accept' | 'reject' => {
  return input.resolution === 'reject' ? 'reject' : 'accept'
}

const normalizeModerationReply = (content: string) => content.trim() || '已处理'

export const createShoutboxReport = async (
  input: ShoutboxReportInput,
  userId: number,
  options: { now?: Date; db?: PrismaClient } = {}
) => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const reason = input.content.trim()
  if (reason.length < 2) return '举报原因最少 2 个字符'

  const result = await db.$transaction(async (tx) => {
    const row = await lockShoutbox(tx, input.shoutboxId)
    if (!row) return '小喇叭不存在'
    if (row.user_id === userId) return '不能举报自己的小喇叭'

    const effectiveFrom = asDate(row.effective_from)
    const notYetEffective =
      row.official &&
      effectiveFrom !== null &&
      effectiveFrom.getTime() > now.getTime()
    if (row.status === 1 || row.status === 3 || notYetEffective) {
      return '当前小喇叭不接受举报'
    }
    if (row.status !== 0 && row.status !== 2) {
      return '当前小喇叭不接受举报'
    }
    if (row.official && row.status === 2) {
      return '当前官方小喇叭不接受举报'
    }

    const existing = await tx.patch_report.findFirst({
      where: {
        ...shoutboxReportWhere(input.shoutboxId),
        sender_id: userId
      },
      select: { id: true }
    })
    if (existing) return '您已经举报过该小喇叭，请等待站方处理'

    const created = await tx.patch_report.create({
      data: {
        target_type: 'shoutbox',
        reason,
        sender_id: userId,
        reported_user_id: row.user_id,
        patch_id: row.patch_id,
        shoutbox_id: row.id
      },
      select: { id: true, sender_id: true }
    })

    const reports = await getPendingShoutboxReports(tx, row.id)
    const reporterIds = new Set(
      reports
        .map((report) => report.sender_id)
        .concat(created?.sender_id ?? userId)
    )
    if (
      !row.official &&
      row.status === 0 &&
      reporterIds.size >= SHOUTBOX_AUTO_HIDE_REPORTER_THRESHOLD
    ) {
      const hidden = await tx.shoutbox.updateMany({
        where: { id: row.id, official: false, status: 0 },
        data: { status: 2, hidden_at: now }
      })
      if (hidden.count === 1) {
        const notice = createShoutboxAuthorNotice('hide', row.id)
        await createMessage({ ...notice, recipient_id: row.user_id }, tx)
        return { hidden: true }
      }
    }
    return { hidden: false }
  })

  if (typeof result === 'string') return result
  if (typeof result === 'object' && result !== null && result.hidden) {
    await invalidateShoutboxCaches()
  }
  return {}
}

type ShoutboxModerateOptions = {
  now?: Date
  db?: PrismaClient
  adminRole?: number
}

export const moderateShoutbox = async (
  input: AdminShoutboxModerateInput,
  adminId: number,
  options: ShoutboxModerateOptions = {}
) => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  if (options.adminRole !== undefined && options.adminRole < 3) {
    return '本页面仅管理员可访问'
  }
  if (input.action === 'resolve' && input.resolution === undefined) {
    return '结案必须提供受理或驳回结论'
  }

  const result = await runWithTransactionRetry(async (tx) => {
    const row = await lockShoutbox(tx, input.shoutboxId)
    if (!row) return '小喇叭不存在'

    if (input.action === 'resolve') {
      if (row.status === 2) {
        return '隐藏中的小喇叭必须删除或恢复'
      }
      const reports = await getPendingShoutboxReports(tx, row.id)
      if (!reports.length) return { changed: false }
      const decision = normalizeModerationDecision(input)
      const reply = normalizeModerationReply(input.content)
      const status = decision === 'reject' ? 3 : 2
      await tx.patch_report.updateMany({
        where: shoutboxReportWhere(row.id),
        data: {
          status,
          handler_id: adminId,
          handler_reply: reply,
          handled_at: now
        }
      })
      const reporterIds = new Set<number>()
      for (const report of reports) {
        if (reporterIds.has(report.sender_id)) continue
        reporterIds.add(report.sender_id)
        await createMessage(
          {
            ...createShoutboxReporterNotice(
              decision === 'accept',
              report.reason ?? '',
              reply,
              row.id
            ),
            recipient_id: report.sender_id
          },
          tx
        )
      }
      if (!row.official && !reporterIds.has(row.user_id)) {
        await createMessage(
          {
            type: 'report',
            content: `您的小喇叭举报已完成复核，结论为${decision === 'accept' ? '受理' : '驳回'}。`,
            recipient_id: row.user_id,
            link: shoutboxLink(row.id)
          },
          tx
        )
      }
      await tx.admin_log.create({
        data: {
          type: 'shoutbox_moderate',
          user_id: adminId,
          content: `管理员结案小喇叭举报 #${row.id}`
        }
      })
      return { changed: true }
    }

    if (row.official) return '官方小喇叭只能结案，不能执行该处置'

    const nextStatus =
      input.action === 'hide' ? 2 : input.action === 'remove' ? 3 : 0
    const allowedStatuses =
      input.action === 'hide'
        ? [0]
        : input.action === 'remove'
          ? [0, 2]
          : [2, 3]
    const updated = await tx.shoutbox.updateMany({
      where: {
        id: row.id,
        official: false,
        status: { in: allowedStatuses }
      },
      data:
        input.action === 'hide'
          ? { status: nextStatus, hidden_at: now }
          : input.action === 'restore'
            ? { status: nextStatus, hidden_at: null }
            : { status: nextStatus }
    })
    if (updated.count === 0) {
      return input.action === 'hide'
        ? '当前小喇叭不能隐藏'
        : input.action === 'remove'
          ? '当前小喇叭不能删除'
          : '当前小喇叭不能恢复'
    }

    if (
      input.action === 'restore' &&
      row.cost > 0 &&
      row.refunded_at === null
    ) {
      await refundMoemoepoint(tx, {
        userId: row.user_id,
        amount: row.cost,
        reasonCode: MOEMOEPOINT_REASON.shoutboxRestoreRefund.code,
        reason: MOEMOEPOINT_REASON.shoutboxRestoreRefund.text,
        referenceType: 'shoutbox',
        referenceId: row.id,
        link: shoutboxLink(row.id),
        operatorId: adminId,
        idempotencyKey: `shoutbox:${row.id}:restore-refund`
      })
      await tx.shoutbox.updateMany({
        where: { id: row.id, status: 0, refunded_at: null },
        data: { refunded_at: now }
      })
    }

    if (input.action === 'remove' || input.action === 'restore') {
      const reports = await getPendingShoutboxReports(tx, row.id)
      const reportStatus = input.action === 'restore' ? 3 : 2
      const reply = input.action === 'restore' ? '举报已驳回' : '已处理'
      await tx.patch_report.updateMany({
        where: shoutboxReportWhere(row.id),
        data: {
          status: reportStatus,
          handler_id: adminId,
          handler_reply: reply,
          handled_at: now
        }
      })
      const reporterIds = new Set<number>()
      for (const report of reports) {
        if (reporterIds.has(report.sender_id)) continue
        reporterIds.add(report.sender_id)
        await createMessage(
          {
            ...createShoutboxReporterNotice(
              input.action === 'remove',
              report.reason ?? '',
              reply,
              row.id
            ),
            recipient_id: report.sender_id
          },
          tx
        )
      }
      if (!reporterIds.has(row.user_id)) {
        await createMessage(
          {
            ...createShoutboxAuthorNotice(input.action, row.id),
            recipient_id: row.user_id
          },
          tx
        )
      }
    } else {
      await createMessage(
        {
          ...createShoutboxAuthorNotice('hide', row.id),
          recipient_id: row.user_id
        },
        tx
      )
    }

    await tx.admin_log.create({
      data: {
        type: 'shoutbox_moderate',
        user_id: adminId,
        content: `管理员执行小喇叭${input.action} #${row.id}`
      }
    })
    return { changed: true }
  }, db)

  if (typeof result === 'object' && result !== null && result.changed) {
    await invalidateShoutboxCaches()
  }
  return typeof result === 'object' ? {} : result
}

type AdminShoutboxTab = AdminShoutboxListInput['tab']

const adminShoutboxWhere = (
  tab: AdminShoutboxTab
): Prisma.shoutboxWhereInput => {
  if (tab === 'pending_review') {
    return {
      OR: [
        { status: 2 },
        { reports: { some: { target_type: 'shoutbox', status: 0 } } }
      ]
    }
  }
  if (tab === 'public') return { status: 0, official: false }
  if (tab === 'removed') return { official: false, status: { in: [1, 3] } }
  return { official: true }
}

const getPendingReviewIds = async (
  input: AdminShoutboxListInput,
  db: PrismaClient
) => {
  if (typeof db.$queryRaw !== 'function') return []
  const offset = (input.page - 1) * input.limit
  const rows = await db.$queryRaw<{ id: number }[]>(Prisma.sql`
    SELECT s.id
    FROM shoutbox s
    LEFT JOIN patch_report r
      ON r.shoutbox_id = s.id
     AND r.target_type = 'shoutbox'
     AND r.status = 0
    WHERE s.status = 2 OR r.id IS NOT NULL
    GROUP BY s.id
    ORDER BY COALESCE(MIN(r.created), s.hidden_at) ASC NULLS LAST,
             s.id ASC
    OFFSET ${offset}
    LIMIT ${input.limit}
  `)
  return Array.isArray(rows) ? rows.map((row) => row.id) : []
}

export const getAdminShoutboxList = async (
  input: AdminShoutboxListInput,
  options: { db?: PrismaClient; adminRole?: number } = {}
) => {
  const db = options.db ?? prisma
  if (options.adminRole !== undefined && options.adminRole < 3) {
    return '本页面仅管理员可访问'
  }
  const where = adminShoutboxWhere(input.tab)
  const total = await db.shoutbox.count({ where })
  if (!total) {
    return { shoutboxes: [], page: input.page, totalPages: 0 }
  }
  const totalPages = Math.ceil(total / input.limit)
  if (input.page > totalPages) {
    return {
      shoutboxes: [],
      page: input.page,
      totalPages
    } satisfies AdminShoutboxListResponse
  }
  const ids =
    input.tab === 'pending_review' ? await getPendingReviewIds(input, db) : null
  let rows: ShoutboxDbRow[]
  if (ids && ids.length) {
    rows = await db.shoutbox.findMany({
      where: { id: { in: ids } },
      select: shoutboxSelect
    })
  } else if (ids && ids.length === 0) {
    rows = []
  } else {
    rows = await db.shoutbox.findMany({
      where,
      orderBy:
        input.tab === 'pending_review'
          ? [{ created: 'asc' }, { id: 'asc' }]
          : [{ created: 'desc' }, { id: 'desc' }],
      skip: (input.page - 1) * input.limit,
      take: input.limit,
      select: shoutboxSelect
    })
  }
  const rowsById = new Map(rows.map((row) => [row.id, row]))
  const orderedRows = ids
    ? ids.flatMap((id) => {
        const row = rowsById.get(id)
        return row ? [row] : []
      })
    : rows
  let shoutboxes: Array<ShoutboxItem | AdminShoutboxReviewItem> =
    orderedRows.map((row) => serializeShoutbox(row))
  if (input.tab === 'pending_review' && orderedRows.length) {
    const reports = await db.patch_report.findMany({
      where: {
        target_type: 'shoutbox',
        status: 0,
        shoutbox_id: { in: orderedRows.map((row) => row.id) }
      },
      orderBy: [{ created: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        shoutbox_id: true,
        reason: true,
        created: true,
        sender: { select: userSelect }
      }
    })
    const reportsByShoutbox = new Map<number, ShoutboxPendingReport[]>()
    for (const report of reports) {
      if (report.shoutbox_id === null) continue
      const list = reportsByShoutbox.get(report.shoutbox_id) ?? []
      list.push({
        id: report.id,
        reason: report.reason,
        sender: report.sender,
        created: report.created.toISOString()
      })
      reportsByShoutbox.set(report.shoutbox_id, list)
    }
    shoutboxes = orderedRows.map((row) => ({
      ...serializeShoutbox(row),
      pendingReports: reportsByShoutbox.get(row.id) ?? []
    }))
  }
  return {
    shoutboxes,
    page: input.page,
    totalPages
  } satisfies AdminShoutboxListResponse
}

export const getUserShoutboxes = async (
  input: ShoutboxProfileInput,
  viewer: { uid: number; role: number } | null,
  options: {
    db?: PrismaClient
    visibilityWhere?: Prisma.patchWhereInput
    now?: Date
  } = {}
): Promise<ShoutboxProfileResponse> => {
  if (!viewer) {
    return { shoutboxes: [], page: input.page, totalPages: 0 }
  }
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const own = viewer.uid === input.uid || viewer.role >= 3
  const where: Prisma.shoutboxWhereInput = own
    ? { user_id: input.uid }
    : { ...publicBaseWhere(now), user_id: input.uid }
  const [total, rows] = await Promise.all([
    db.shoutbox.count({ where }),
    db.shoutbox.findMany({
      where,
      orderBy: [{ created: 'desc' }, { id: 'desc' }],
      skip: (input.page - 1) * input.limit,
      take: input.limit,
      select: shoutboxSelect
    })
  ])
  return {
    shoutboxes: rows.map((row) =>
      serializeShoutbox(row, options.visibilityWhere ?? {})
    ),
    page: input.page,
    totalPages: Math.ceil(total / input.limit)
  }
}

export const getAdminOfficialShoutboxes = async (
  input: AdminShoutboxListInput,
  options: { db?: PrismaClient; adminRole?: number } = {}
) => {
  const db = options.db ?? prisma
  if (options.adminRole !== undefined && options.adminRole < 3) {
    return '本页面仅管理员可访问'
  }
  const where: Prisma.shoutboxWhereInput = { official: true }
  const [total, rows] = await Promise.all([
    db.shoutbox.count({ where }),
    db.shoutbox.findMany({
      where,
      orderBy: [{ created: 'desc' }, { id: 'desc' }],
      skip: (input.page - 1) * input.limit,
      take: input.limit,
      select: shoutboxSelect
    })
  ])
  return {
    shoutboxes: rows.map((row) => serializeShoutbox(row)),
    page: input.page,
    totalPages: Math.ceil(total / input.limit)
  }
}

export { MoemoepointInsufficientError }
