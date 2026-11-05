import { Prisma, type PrismaClient } from '@prisma/client'
import { setTimeout as wait } from 'node:timers/promises'
import { prisma } from '~/prisma/index'
import { LINK_HEALTH_ERRORS } from '~/constants/linkHealth'
import { linkHealthSelect } from './linkHealthProjection'

export class ResourceMutationError extends Error {
  constructor(
    public readonly message: string,
    public readonly status = 409
  ) {
    super(message)
  }
}

export const resourceMutationInclude = (now = new Date()) =>
  ({
    patch: { select: { name: true, unique_id: true } },
    user: { include: { _count: { select: { patch_resource: true } } } },
    links: { select: linkHealthSelect(now), orderBy: [{ id: 'asc' as const }] }
  }) satisfies Prisma.patch_resourceInclude

export type LockedResource = Prisma.patch_resourceGetPayload<{
  include: ReturnType<typeof resourceMutationInclude>
}>

/** Lock the parent before reading or locking its complete child set. */
export const lockResourceForMutation = async (
  tx: Prisma.TransactionClient,
  resourceId: number,
  now = new Date()
): Promise<LockedResource | null> => {
  const rows = await tx.$queryRaw<{ id: number }[]>(Prisma.sql`
    SELECT id FROM patch_resource WHERE id=${resourceId} FOR UPDATE
  `)
  if (!rows.length) return null
  await tx.$queryRaw(Prisma.sql`
    SELECT id FROM patch_resource_link WHERE resource_id=${resourceId}
    ORDER BY id ASC FOR UPDATE
  `)
  return tx.patch_resource.findUnique({
    where: { id: resourceId },
    include: resourceMutationInclude(now)
  })
}

const retryable = (error: unknown) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const adapter = error.meta?.driverAdapterError as
      | { cause?: { originalCode?: unknown } }
      | undefined
    return (
      error.code === 'P2034' ||
      (error.code === 'P2010' &&
        ['40001', '40P01'].includes(
          String(error.meta?.code ?? adapter?.cause?.originalCode)
        ))
    )
  }
  return (
    error instanceof Error &&
    error.name === 'DriverAdapterError' &&
    typeof error.cause === 'object' &&
    error.cause !== null &&
    ['40001', '40P01'].includes(
      String((error.cause as { originalCode?: string }).originalCode)
    )
  )
}

/** Retry DB work only; upload/checker/network calls stay outside callbacks. */
export const runResourceMutation = async <T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>
) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(work)
    } catch (error) {
      if (!retryable(error)) throw error
      if (attempt === 2)
        throw new ResourceMutationError(
          LINK_HEALTH_ERRORS.unavailable.message,
          503
        )
      await wait(50 * 2 ** attempt)
    }
  }
  throw new ResourceMutationError(LINK_HEALTH_ERRORS.unavailable.message, 503)
}

export const resourcePostCommit = async (
  operation: string,
  work: () => Promise<unknown>
) => {
  try {
    await work()
  } catch {
    console.error('[Resource] Postcommit operation failed', { operation })
  }
}

export const HANDOVER_MESSAGES = {
  forbidden: '您没有权限交由站方维护',
  editClosed: '您已将这份资源交由站方维护，不能再编辑',
  deleteClosed: '您已将这份资源交由站方维护，不能再删除',
  backupChanged: '站方备份已变化，请重新确认是否交由站方维护',
  backupMissing: '这份资源还没有站方备份，请重新确认是否删除',
  invalidLocator: '资源文件位置无法清理，交接已取消',
  cleanupUnavailable: '资源文件清理暂不可用，请稍后再试',
  caseConflict: '事项刚刚发生变化，请刷新后重试'
} as const

export const HANDOVER_HTTP_ERRORS = [
  { status: 403, message: HANDOVER_MESSAGES.forbidden },
  { status: 403, message: HANDOVER_MESSAGES.editClosed },
  { status: 403, message: HANDOVER_MESSAGES.deleteClosed },
  { status: 409, message: HANDOVER_MESSAGES.backupChanged },
  { status: 409, message: HANDOVER_MESSAGES.backupMissing },
  { status: 409, message: HANDOVER_MESSAGES.invalidLocator },
  { status: 409, message: HANDOVER_MESSAGES.caseConflict },
  { status: 503, message: HANDOVER_MESSAGES.cleanupUnavailable }
] as const

export const handoverStatus = (message: string) =>
  HANDOVER_HTTP_ERRORS.find((error) => error.message === message)?.status

type HandoverColumnClient = PrismaClient | Prisma.TransactionClient

/** Generated column. A missing row is treated as not handed over. */
export const readPublisherLeftAt = async (
  db: HandoverColumnClient,
  resourceId: number
): Promise<Date | null> => {
  const row = await db.patch_resource.findUnique({
    where: { id: resourceId },
    select: { publisher_left_at: true }
  })
  return row?.publisher_left_at ?? null
}

export const readPublisherLeftMap = async (
  db: HandoverColumnClient,
  resourceIds: readonly number[]
) => {
  if (!resourceIds.length) return new Map<number, Date | null>()
  const rows = await db.patch_resource.findMany({
    where: { id: { in: [...resourceIds] } },
    select: { id: true, publisher_left_at: true }
  })
  return new Map(rows.map((row) => [row.id, row.publisher_left_at] as const))
}

export const listHandedOverResourceIds = async (
  db: HandoverColumnClient,
  userId?: number
) => {
  const rows = await db.patch_resource.findMany({
    where: {
      publisher_left_at: { not: null },
      ...(userId === undefined ? {} : { user_id: userId })
    },
    select: { id: true },
    orderBy: { id: 'asc' }
  })
  return rows.map((row) => row.id)
}

/**
 * One-row conditional write. False means the card was already handed over.
 * updateMany does not apply @updatedAt, so updated is set in the same write.
 */
export const markPublisherLeft = async (
  db: HandoverColumnClient,
  resourceId: number,
  now: Date
) => {
  const changed = await db.patch_resource.updateMany({
    where: { id: resourceId, publisher_left_at: null },
    data: { publisher_left_at: now, updated: now }
  })
  return changed.count === 1
}

export type LinkChangeFact = {
  id: number
  resourceId: number
  storage: string
  attachedAt: Date | null
  contentChangedAt: Date | null
  changedAt: Date | null
}

export const linkChangedAt = (
  attachedAt: Date | null,
  contentChangedAt: Date | null
) => {
  const times = [attachedAt, contentChangedAt].filter(
    (value): value is Date => value !== null
  )
  if (!times.length) return null
  return new Date(Math.max(...times.map((value) => value.getTime())))
}

export const readLinkChangeFacts = async (
  db: HandoverColumnClient,
  resourceIds: readonly number[]
): Promise<LinkChangeFact[]> => {
  if (!resourceIds.length) return []
  const rows = await db.patch_resource_link.findMany({
    where: { resource_id: { in: [...resourceIds] } },
    select: {
      id: true,
      resource_id: true,
      storage: true,
      attached_at: true,
      content_changed_at: true
    },
    orderBy: { id: 'asc' }
  })
  return rows.map((row) => ({
    id: row.id,
    resourceId: row.resource_id,
    storage: row.storage,
    attachedAt: row.attached_at,
    contentChangedAt: row.content_changed_at,
    changedAt: linkChangedAt(row.attached_at, row.content_changed_at)
  }))
}

export const assertPublisherStillMaintains = (
  leftAt: Date | null,
  resourceUserId: number,
  uid: number,
  role: number
) => {
  if (leftAt && role < 3 && resourceUserId === uid) {
    throw new ResourceMutationError(HANDOVER_MESSAGES.editClosed, 403)
  }
}
