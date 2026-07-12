import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { accessPatchResourceLinkSchema } from '~/validations/patch'
import {
  resolveResourceAccessGrant,
  ResourceAccessGrantBusyError
} from './grant'
import { logResourceAccessOutcome } from './observability'
import type { Prisma } from '@prisma/client'
import type { ResourceAccessActor } from './actor'
import type { PatchResourceAccessResponse } from '~/types/api/patch'

export type ResourceAccessServiceError = {
  kind: 'resource-access-error'
  status: 404 | 429 | 503
  message: string
  retryAfterSeconds?: number
}

export const isResourceAccessServiceError = (
  value: unknown
): value is ResourceAccessServiceError =>
  Boolean(
    value &&
      typeof value === 'object' &&
      (value as { kind?: unknown }).kind === 'resource-access-error' &&
      typeof (value as { message?: unknown }).message === 'string' &&
      [404, 429, 503].includes((value as { status?: number }).status ?? 0)
  )

const createResourceAccessError = (
  status: ResourceAccessServiceError['status'],
  message: string,
  retryAfterSeconds?: number
): ResourceAccessServiceError => ({
  kind: 'resource-access-error',
  status,
  message,
  ...(retryAfterSeconds ? { retryAfterSeconds } : {})
})

const formatRetryDuration = (seconds: number) => {
  if (seconds >= 24 * 60 * 60) {
    return `${Math.ceil(seconds / (24 * 60 * 60))} 天`
  }
  if (seconds >= 60 * 60) {
    return `${Math.ceil(seconds / (60 * 60))} 小时`
  }
  if (seconds >= 60) {
    return `${Math.ceil(seconds / 60)} 分钟`
  }
  return `${Math.max(1, seconds)} 秒`
}

const formatResourceAccessLimitMessage = (
  window: 'daily' | 'weekly',
  retryAfterSeconds: number
) =>
  `${window === 'daily' ? '今日' : '本周'}游客获取次数已达上限，登录后可继续获取，或 ${formatRetryDuration(
    retryAfterSeconds
  )}后再试`

export const accessPatchResourceLink = async (
  input: z.infer<typeof accessPatchResourceLinkSchema>,
  visibilityWhere: Prisma.patchWhereInput,
  actor: ResourceAccessActor
): Promise<PatchResourceAccessResponse | ResourceAccessServiceError> => {
  const link = await prisma.patch_resource_link.findFirst({
    where: {
      id: input.linkId,
      resource_id: input.resourceId,
      resource: {
        id: input.resourceId,
        patch_id: input.patchId,
        status: 0,
        patch: {
          id: input.patchId,
          status: 0,
          ...visibilityWhere
        }
      }
    },
    select: {
      id: true,
      storage: true,
      size: true,
      content: true,
      code: true,
      password: true,
      hash: true,
      resource: {
        select: {
          id: true,
          section: true,
          patch_id: true
        }
      }
    }
  })

  if (!link) {
    return createResourceAccessError(404, '未找到对应资源链接')
  }

  const section = link.resource.section
  if (section !== 'galgame' && section !== 'patch') {
    throw new Error('Invalid resource section')
  }

  const now = new Date()
  let result: Awaited<ReturnType<typeof resolveResourceAccessGrant>>
  try {
    result = await resolveResourceAccessGrant({
      actor,
      patchId: link.resource.patch_id,
      resourceId: link.resource.id,
      linkId: link.id,
      storage: link.storage,
      section,
      now
    })
  } catch (error) {
    if (error instanceof ResourceAccessGrantBusyError) {
      return createResourceAccessError(503, '获取下载链接繁忙，请稍后再试', 1)
    }
    throw error
  }

  if (result.kind === 'limited') {
    logResourceAccessOutcome({
      operation: 'access',
      outcome: result.window === 'daily' ? 'daily_limited' : 'weekly_limited',
      actorType: actor.actorType,
      section
    })
    return createResourceAccessError(
      429,
      formatResourceAccessLimitMessage(result.window, result.retryAfterSeconds),
      result.retryAfterSeconds
    )
  }

  if (result.kind === 'reused') {
    logResourceAccessOutcome({
      operation: 'access',
      outcome: 'manual_reused',
      actorType: actor.actorType,
      section
    })
  }

  const { resource: _resource, ...safeLink } = link
  const quota =
    result.kind === 'resource_granted' &&
    actor.actorType === 'visitor' &&
    section === 'galgame' &&
    result.quota?.scope === 'visitor' &&
    result.quota.resourceKind === 'galgame'
      ? result.quota
      : undefined

  return {
    link: safeLink,
    access: {
      kind: result.kind,
      actorType: actor.actorType,
      cost: 0,
      obtainedExpiresAt: result.expires.toISOString()
    },
    ...(quota ? { quota } : {})
  }
}
