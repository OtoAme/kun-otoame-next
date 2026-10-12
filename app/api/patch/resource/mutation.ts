import { Prisma } from '@prisma/client'
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
