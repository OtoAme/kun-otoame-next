import { Prisma } from '@prisma/client'
import { setTimeout as wait } from 'node:timers/promises'
import { prisma } from '~/prisma/index'
import { getResourceAccessPolicy, RESOURCE_ACCESS_GRANT_MS } from './policy'
import { getShanghaiQuotaWindows } from './timeWindow'
import { getResourceAccessActorKey, getResourceAccessActorWhere } from './actor'
import type { ResourceAccessActor } from './actor'

const RESOURCE_ACCESS_GRANT_RETRY_COUNT = 3
const RESOURCE_ACCESS_GRANT_RETRY_BASE_DELAY_MS = 50

type GrantInput = {
  actor: ResourceAccessActor
  patchId: number
  resourceId: number
  linkId: number
  storage: string
  section: 'galgame' | 'patch'
  now: Date
  /**
   * Production passes a clock so each conflict retry reads a new instant.
   * One attempt still uses a single now. Tests omit this and keep `now`.
   */
  clock?: () => Date
  visibilityWhere?: Prisma.patchWhereInput
}

type VisitorQuotaPayload = {
  scope: 'visitor'
  resourceKind: 'galgame'
  remaining: { daily: number; weekly: number }
  resetsAt: { daily: string; weekly: string }
}

type VisitorQuotaCheck =
  | { allowed: true; quota?: VisitorQuotaPayload }
  | {
      allowed: false
      window: 'daily' | 'weekly'
      retryAfterSeconds: number
      remaining: { daily: number; weekly: number }
      resetsAt: { daily: string; weekly: string }
    }

const buildAccessEventCreateData = (
  input: GrantInput,
  linkVersion: number
) => ({
  actor_type: input.actor.actorType,
  user_id: input.actor.actorType === 'user' ? input.actor.uid : null,
  visitor_token:
    input.actor.actorType === 'visitor' ? input.actor.visitorToken : '',
  patch_id: input.patchId,
  resource_id: input.resourceId,
  link_id: input.linkId,
  link_version: linkVersion,
  section: input.section,
  storage: input.storage,
  cost: 0,
  created: input.now
})

const checkVisitorResourceQuota = async (
  tx: Prisma.TransactionClient,
  input: GrantInput
): Promise<VisitorQuotaCheck> => {
  const policy = getResourceAccessPolicy(input.actor.actorType, input.section)
  if (policy.productQuota === 'none' || input.actor.actorType !== 'visitor') {
    return { allowed: true }
  }

  const windows = getShanghaiQuotaWindows(input.now)
  const actorWhere = getResourceAccessActorWhere(input.actor)
  const baseWhere = {
    ...actorWhere,
    section: 'galgame',
    access_kind: 'resource_grant'
  } satisfies Prisma.patch_resource_accessWhereInput
  const [dailyUsed, weeklyUsed] = await Promise.all([
    tx.patch_resource_access.count({
      where: { ...baseWhere, created: { gte: windows.dailyStart } }
    }),
    tx.patch_resource_access.count({
      where: { ...baseWhere, created: { gte: windows.weeklyStart } }
    })
  ])
  const currentRemaining = {
    daily: Math.max(0, policy.dailyLimit - dailyUsed),
    weekly: Math.max(0, policy.weeklyLimit - weeklyUsed)
  }
  const resetsAt = {
    daily: windows.dailyResetAt.toISOString(),
    weekly: windows.weeklyResetAt.toISOString()
  }

  if (dailyUsed >= policy.dailyLimit) {
    return {
      allowed: false,
      window: 'daily',
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((windows.dailyResetAt.getTime() - input.now.getTime()) / 1000)
      ),
      remaining: currentRemaining,
      resetsAt
    }
  }

  if (weeklyUsed >= policy.weeklyLimit) {
    return {
      allowed: false,
      window: 'weekly',
      retryAfterSeconds: Math.max(
        1,
        Math.ceil(
          (windows.weeklyResetAt.getTime() - input.now.getTime()) / 1000
        )
      ),
      remaining: currentRemaining,
      resetsAt
    }
  }

  return {
    allowed: true,
    quota: {
      scope: 'visitor',
      resourceKind: 'galgame',
      remaining: {
        daily: currentRemaining.daily - 1,
        weekly: currentRemaining.weekly - 1
      },
      resetsAt
    }
  }
}

const isSerializationCode = (value: unknown) => {
  const code = String(value)
  return code === '40001' || code === '40P01'
}

/**
 * Retry only recognized database conflicts. Raw `FOR UPDATE` arrives as
 * P2010 or a driver adapter error; other P2010 codes stay fatal.
 */
export const isRetryableGrantConflict = (error: unknown) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002' || error.code === 'P2034') return true
    if (error.code !== 'P2010') return false
    const adapter = error.meta?.driverAdapterError as
      | { cause?: { originalCode?: unknown } }
      | undefined
    return (
      isSerializationCode(error.meta?.code) ||
      isSerializationCode(adapter?.cause?.originalCode)
    )
  }
  return (
    error instanceof Error &&
    error.name === 'DriverAdapterError' &&
    typeof error.cause === 'object' &&
    error.cause !== null &&
    isSerializationCode(
      (error.cause as { originalCode?: unknown }).originalCode
    )
  )
}

class ResourceAccessTargetMissingError extends Error {
  constructor() {
    super('Resource access target missing')
    this.name = 'ResourceAccessTargetMissingError'
  }
}

export type GrantDownloadAccounting = {
  uniqueId: string
  download: number
  resourceId: number
  linkId: number
  kind: 'resource_granted' | 'link_revealed'
}

const changedRowCount = (count: number) => Number(count) === 1

const lockVisibleResource = async (
  tx: Prisma.TransactionClient,
  input: GrantInput
) => {
  const rows = await tx.$queryRaw<{ id: number }[]>`
    SELECT id
    FROM patch_resource
    WHERE id = ${input.resourceId}
      AND patch_id = ${input.patchId}
      AND status = 0
    FOR UPDATE
  `
  return rows.length > 0
}

const readPatchDownload = async (
  tx: Prisma.TransactionClient,
  patchId: number
) => {
  const rows = await tx.$queryRaw<{ unique_id: string; download: number }[]>`
    SELECT unique_id, download
    FROM patch
    WHERE id = ${patchId}
  `
  return rows[0] ?? null
}

// Raw updates avoid Prisma @updatedAt. Merge previews compare that timestamp.
const incrementLinkDownload = (
  tx: Prisma.TransactionClient,
  input: GrantInput
) => tx.$executeRaw`
  UPDATE patch_resource_link
  SET download = download + 1
  WHERE id = ${input.linkId}
    AND resource_id = ${input.resourceId}
`

const incrementResourceDownload = (
  tx: Prisma.TransactionClient,
  input: GrantInput
) => tx.$executeRaw`
  UPDATE patch_resource
  SET download = download + 1
  WHERE id = ${input.resourceId}
    AND patch_id = ${input.patchId}
    AND status = 0
`

const incrementPatchDownload = async (
  tx: Prisma.TransactionClient,
  patchId: number
) => {
  const rows = await tx.$queryRaw<{ unique_id: string; download: number }[]>`
    UPDATE patch
    SET download = download + 1
    WHERE id = ${patchId}
    RETURNING unique_id, download
  `
  return rows[0] ?? null
}

const countedDownload = async (
  tx: Prisma.TransactionClient,
  input: GrantInput,
  kind: GrantDownloadAccounting['kind']
): Promise<GrantDownloadAccounting> => {
  // Caller already holds the resource row lock and has re-read the target.
  if (kind === 'resource_granted') {
    const resourceCount = await incrementResourceDownload(tx, input)
    if (!changedRowCount(resourceCount)) {
      throw new ResourceAccessTargetMissingError()
    }
  }

  const linkCount = await incrementLinkDownload(tx, input)
  if (!changedRowCount(linkCount)) throw new ResourceAccessTargetMissingError()

  const patch =
    kind === 'resource_granted'
      ? await incrementPatchDownload(tx, input.patchId)
      : await readPatchDownload(tx, input.patchId)
  if (!patch) throw new ResourceAccessTargetMissingError()

  return {
    uniqueId: patch.unique_id,
    download: Number(patch.download),
    resourceId: input.resourceId,
    linkId: input.linkId,
    kind
  }
}

export class ResourceAccessGrantBusyError extends Error {}

const attemptInstant = (input: GrantInput) =>
  input.clock ? input.clock() : input.now

export const resolveResourceAccessGrant = async (input: GrantInput) => {
  for (
    let attempt = 0;
    attempt < RESOURCE_ACCESS_GRANT_RETRY_COUNT;
    attempt++
  ) {
    // A new attempt must not keep a now that has already crossed expiry.
    const attemptInput: GrantInput = { ...input, now: attemptInstant(input) }
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Resource row first, before the branch and before any counter.
          // Merge locks resources, then links, then grants. Do not invert that.
          const locked = await lockVisibleResource(tx, attemptInput)
          if (!locked) return { kind: 'not_found' as const }

          const target = await tx.patch_resource_link.findFirst({
            where: {
              id: attemptInput.linkId,
              resource_id: attemptInput.resourceId,
              resource: {
                id: attemptInput.resourceId,
                patch_id: attemptInput.patchId,
                status: 0,
                patch: {
                  id: attemptInput.patchId,
                  status: 0,
                  ...attemptInput.visibilityWhere
                }
              }
            },
            select: {
              id: true,
              version: true,
              storage: true,
              size: true,
              content: true,
              code: true,
              password: true,
              hash: true,
              resource: { select: { section: true } }
            }
          })
          if (!target) return { kind: 'not_found' as const }
          const { resource, ...link } = target
          if (resource.section !== 'galgame' && resource.section !== 'patch') {
            throw new Error('Invalid resource section')
          }
          // Address, version and visibility all come from this locked read.
          const snapshotInput: GrantInput = {
            ...attemptInput,
            storage: link.storage,
            section: resource.section
          }
          const actorKey = getResourceAccessActorKey(attemptInput.actor)
          const current = await tx.patch_resource_access_grant.findUnique({
            where: {
              actor_key_resource_id: {
                actor_key: actorKey,
                resource_id: attemptInput.resourceId
              }
            }
          })
          const grantIsLive = Boolean(
            current && current.expires > attemptInput.now
          )

          if (current && grantIsLive) {
            // A live event is not enough on its own. Reuse also needs this grant.
            // Match the actor, the current version, and an unexpired event.
            // Do not require the event to last until the grant.
            const revealed = await tx.patch_resource_access.findFirst({
              where: {
                ...getResourceAccessActorWhere(attemptInput.actor),
                resource_id: attemptInput.resourceId,
                link_id: attemptInput.linkId,
                link_version: link.version,
                expires: { gt: attemptInput.now }
              },
              orderBy: { expires: 'desc' },
              select: { expires: true }
            })

            if (
              revealed?.expires instanceof Date &&
              revealed.expires > attemptInput.now
            ) {
              return {
                kind: 'reused' as const,
                expires: current.expires,
                revealedExpiresAt: revealed.expires,
                link,
                section: snapshotInput.section
              }
            }

            const accounting = await countedDownload(
              tx,
              snapshotInput,
              'link_revealed'
            )
            await tx.patch_resource_access.create({
              data: {
                ...buildAccessEventCreateData(snapshotInput, link.version),
                access_kind: 'link_reveal',
                expires: current.expires
              }
            })

            return {
              kind: 'link_revealed' as const,
              expires: current.expires,
              revealedExpiresAt: current.expires,
              link,
              section: snapshotInput.section,
              accounting
            }
          }

          const quotaCheck = await checkVisitorResourceQuota(tx, snapshotInput)
          if (!quotaCheck.allowed) {
            const { allowed: _allowed, ...limited } = quotaCheck
            return { kind: 'limited' as const, ...limited }
          }

          const accounting = await countedDownload(
            tx,
            snapshotInput,
            'resource_granted'
          )
          const expires = new Date(
            attemptInput.now.getTime() + RESOURCE_ACCESS_GRANT_MS
          )
          const grant = current
            ? await tx.patch_resource_access_grant.update({
                where: {
                  actor_key_resource_id: {
                    actor_key: actorKey,
                    resource_id: attemptInput.resourceId
                  }
                },
                data: { expires }
              })
            : await tx.patch_resource_access_grant.create({
                data: {
                  actor_key: actorKey,
                  resource_id: attemptInput.resourceId,
                  expires
                }
              })

          await tx.patch_resource_access.create({
            data: {
              ...buildAccessEventCreateData(snapshotInput, link.version),
              access_kind: 'resource_grant',
              expires
            }
          })

          return {
            kind: 'resource_granted' as const,
            expires: grant.expires,
            revealedExpiresAt: grant.expires,
            link,
            section: snapshotInput.section,
            accounting,
            ...(quotaCheck.quota ? { quota: quotaCheck.quota } : {})
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    } catch (error) {
      if (error instanceof ResourceAccessTargetMissingError) {
        return { kind: 'not_found' as const }
      }
      if (!isRetryableGrantConflict(error)) {
        throw error
      }
      if (attempt === RESOURCE_ACCESS_GRANT_RETRY_COUNT - 1) {
        throw new ResourceAccessGrantBusyError()
      }
      await wait(RESOURCE_ACCESS_GRANT_RETRY_BASE_DELAY_MS * 2 ** attempt)
    }
  }

  throw new ResourceAccessGrantBusyError()
}
