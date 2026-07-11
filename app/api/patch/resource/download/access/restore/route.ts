import { NextRequest } from 'next/server'
import { getPatchVisibilityWhere } from '~/app/api/utils/getPatchVisibilityWhere'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { restorePatchResourceLinksSchema } from '~/validations/patch'
import { getResourceAccessActor } from '../actor'
import { logResourceAccessOutcome } from '../observability'
import {
  resourceAccessJson,
  withResourceAccessVisitorCookie
} from '../response'
import { restorePatchResourceLinks } from './service'

const RESOURCE_ACCESS_RESTORE_BUSY_MESSAGE = '已获取链接恢复繁忙，请稍后再试'

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, restorePatchResourceLinksSchema)
  if (typeof input === 'string') {
    return resourceAccessJson(input, 400)
  }

  const payload = await verifyHeaderCookie(req)
  const actor = getResourceAccessActor(req, payload?.uid ?? 0)

  try {
    const visibilityWhere = await getPatchVisibilityWhere(req)
    const result = await restorePatchResourceLinks(
      input,
      visibilityWhere,
      actor
    )

    logResourceAccessOutcome({
      operation: 'restore',
      outcome: 'restore_succeeded',
      actorType: actor.actorType
    })
    return withResourceAccessVisitorCookie(resourceAccessJson(result), actor)
  } catch {
    logResourceAccessOutcome({
      operation: 'restore',
      outcome: 'restore_failed',
      actorType: actor.actorType
    })
    return withResourceAccessVisitorCookie(
      resourceAccessJson(RESOURCE_ACCESS_RESTORE_BUSY_MESSAGE, 503, {
        'Retry-After': '1'
      }),
      actor
    )
  }
}
