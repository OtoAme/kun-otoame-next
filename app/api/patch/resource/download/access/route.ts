import { NextRequest, NextResponse } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { getPatchVisibilityWhere } from '~/app/api/utils/getPatchVisibilityWhere'
import { accessPatchResourceLinkSchema } from '~/validations/patch'
import { accessPatchResourceLink } from './service'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import {
  getResourceAccessActor,
  setResourceAccessVisitorCookie
} from './actor'

const RESOURCE_ACCESS_CACHE_CONTROL = 'private, no-store'

const resourceAccessJson = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': RESOURCE_ACCESS_CACHE_CONTROL
    }
  })

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, accessPatchResourceLinkSchema)
  if (typeof input === 'string') {
    return resourceAccessJson(input, 400)
  }

  const payload = await verifyHeaderCookie(req)
  const actor = getResourceAccessActor(req, payload?.uid ?? 0)
  const visibilityWhere = await getPatchVisibilityWhere(req)
  const response = await accessPatchResourceLink(input, visibilityWhere, actor)
  if (typeof response === 'string') {
    return resourceAccessJson(response, 404)
  }

  const jsonResponse = resourceAccessJson(response)
  if (actor.actorType === 'visitor' && actor.shouldSetVisitorCookie) {
    setResourceAccessVisitorCookie(jsonResponse, actor.visitorToken)
  }

  return jsonResponse
}
