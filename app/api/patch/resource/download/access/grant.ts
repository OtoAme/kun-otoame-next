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

const buildAccessEventCreateData = (input: GrantInput) => ({
  actor_type: input.actor.actorType,
  user_id: input.actor.actorType === 'user' ? input.actor.uid : null,
  visitor_token:
    input.actor.actorType === 'visitor' ? input.actor.visitorToken : '',
  patch_id: input.patchId,
  resource_id: input.resourceId,
  link_id: input.linkId,
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

const isRetryableGrantConflict = (error: unknown) =>
  (error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2002' || error.code === 'P2034')) ||
  (error instanceof Error &&
    error.name === 'DriverAdapterError' &&
    typeof error.cause === 'object' &&
    error.cause !== null &&
    (error.cause as { kind?: unknown }).kind === 'TransactionWriteConflict' &&
    (error.cause as { originalCode?: unknown }).originalCode === '40001')

export class ResourceAccessGrantBusyError extends Error {}

export const resolveResourceAccessGrant = async (input: GrantInput) => {
  for (
    let attempt = 0;
    attempt < RESOURCE_ACCESS_GRANT_RETRY_COUNT;
    attempt++
  ) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const actorKey = getResourceAccessActorKey(input.actor)
          const current = await tx.patch_resource_access_grant.findUnique({
            where: {
              actor_key_resource_id: {
                actor_key: actorKey,
                resource_id: input.resourceId
              }
            }
          })

          if (current && current.expires > input.now) {
            const revealed = await tx.patch_resource_access.findFirst({
              where: {
                ...getResourceAccessActorWhere(input.actor),
                resource_id: input.resourceId,
                link_id: input.linkId,
                expires: { gte: current.expires }
              },
              select: { id: true }
            })

            if (revealed) {
              return { kind: 'reused' as const, expires: current.expires }
            }

            await tx.patch_resource_access.create({
              data: {
                ...buildAccessEventCreateData(input),
                access_kind: 'link_reveal',
                expires: current.expires
              }
            })

            return {
              kind: 'link_revealed' as const,
              expires: current.expires
            }
          }

          const quotaCheck = await checkVisitorResourceQuota(tx, input)
          if (!quotaCheck.allowed) {
            const { allowed: _allowed, ...limited } = quotaCheck
            return { kind: 'limited' as const, ...limited }
          }

          const expires = new Date(
            input.now.getTime() + RESOURCE_ACCESS_GRANT_MS
          )
          const grant = current
            ? await tx.patch_resource_access_grant.update({
                where: {
                  actor_key_resource_id: {
                    actor_key: actorKey,
                    resource_id: input.resourceId
                  }
                },
                data: { expires }
              })
            : await tx.patch_resource_access_grant.create({
                data: {
                  actor_key: actorKey,
                  resource_id: input.resourceId,
                  expires
                }
              })

          await tx.patch_resource_access.create({
            data: {
              ...buildAccessEventCreateData(input),
              access_kind: 'resource_grant',
              expires
            }
          })

          return {
            kind: 'resource_granted' as const,
            expires: grant.expires,
            ...(quotaCheck.quota ? { quota: quotaCheck.quota } : {})
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    } catch (error) {
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
