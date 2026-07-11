import { NextResponse } from 'next/server'
import { setResourceAccessVisitorCookie } from './actor'
import type { ResourceAccessActor } from './actor'

const RESOURCE_ACCESS_CACHE_CONTROL = 'private, no-store'

export const resourceAccessJson = (
  body: unknown,
  status = 200,
  headers?: Record<string, string>
) => {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('Cache-Control', RESOURCE_ACCESS_CACHE_CONTROL)

  return NextResponse.json(body, {
    status,
    headers: responseHeaders
  })
}

export const withResourceAccessVisitorCookie = (
  response: NextResponse,
  actor: ResourceAccessActor
) => {
  if (actor.actorType === 'visitor' && actor.shouldSetVisitorCookie) {
    setResourceAccessVisitorCookie(response, actor.visitorToken)
  }

  return response
}
