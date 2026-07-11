import { NextRequest } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { getPatchVisibilityWhere } from '~/app/api/utils/getPatchVisibilityWhere'
import { accessPatchResourceLinkSchema } from '~/validations/patch'
import {
  accessPatchResourceLink,
  isResourceAccessServiceError
} from './service'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { getResourceAccessActor } from './actor'
import { resourceAccessJson, withResourceAccessVisitorCookie } from './response'
import { logResourceAccessOutcome } from './observability'

const RESOURCE_ACCESS_BUSY_MESSAGE = '获取下载链接繁忙，请稍后再试'

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, accessPatchResourceLinkSchema)
  if (typeof input === 'string') {
    return resourceAccessJson(input, 400)
  }

  const payload = await verifyHeaderCookie(req)
  const actor = getResourceAccessActor(req, payload?.uid ?? 0)

  try {
    const visibilityWhere = await getPatchVisibilityWhere(req)
    const result = await accessPatchResourceLink(input, visibilityWhere, actor)

    if (isResourceAccessServiceError(result)) {
      if (result.status === 503) {
        logResourceAccessOutcome({
          operation: 'access',
          outcome: 'manual_failed',
          actorType: actor.actorType
        })
      }

      const retryAfterSeconds =
        result.status === 503
          ? (result.retryAfterSeconds ?? 1)
          : result.retryAfterSeconds
      const response = resourceAccessJson(
        result.message,
        result.status,
        retryAfterSeconds
          ? { 'Retry-After': String(retryAfterSeconds) }
          : undefined
      )
      return withResourceAccessVisitorCookie(response, actor)
    }

    return withResourceAccessVisitorCookie(resourceAccessJson(result), actor)
  } catch {
    logResourceAccessOutcome({
      operation: 'access',
      outcome: 'manual_failed',
      actorType: actor.actorType
    })
    return withResourceAccessVisitorCookie(
      resourceAccessJson(RESOURCE_ACCESS_BUSY_MESSAGE, 503, {
        'Retry-After': '1'
      }),
      actor
    )
  }
}
