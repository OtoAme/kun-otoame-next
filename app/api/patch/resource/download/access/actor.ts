import { createHmac, randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { kunCookieOptions } from '~/app/api/utils/cookieOptions'
import { getRemoteIp } from '~/app/api/utils/getRemoteIp'
import { parseCookies } from '~/utils/cookies'
import type { Prisma } from '@prisma/client'
import type { NextRequest } from 'next/server'

export const RESOURCE_ACCESS_VISITOR_COOKIE = 'kun-resource-access-token'
const RESOURCE_ACCESS_VISITOR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180

export type ResourceAccessActor =
  | {
      actorType: 'user'
      uid: number
      visitorToken: ''
      ipHash: string
      shouldSetVisitorCookie: false
    }
  | {
      actorType: 'visitor'
      uid: 0
      visitorToken: string
      ipHash: string
      shouldSetVisitorCookie: boolean
    }

export type ResourceAccessViewer = {
  uid: number
  visitorToken?: string
}

const isValidVisitorToken = (token: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    token
  )

const hashResourceAccessIp = (ip: string) => {
  const secret = process.env.JWT_SECRET
  return secret
    ? createHmac('sha256', secret).update(`resource-access:${ip}`).digest('hex')
    : ''
}

export const getResourceAccessIpHash = (req: NextRequest) => {
  const ip = getRemoteIp(req.headers)
  return ip ? hashResourceAccessIp(ip) : ''
}

export const getResourceAccessVisitorToken = (req: NextRequest) => {
  const token = parseCookies(req.headers.get('cookie') ?? '')[
    RESOURCE_ACCESS_VISITOR_COOKIE
  ]

  return token && isValidVisitorToken(token) ? token : ''
}

export const getResourceAccessActor = (
  req: NextRequest,
  uid: number
): ResourceAccessActor => {
  if (uid > 0) {
    return {
      actorType: 'user',
      uid,
      visitorToken: '',
      ipHash: '',
      shouldSetVisitorCookie: false
    }
  }

  const existingVisitorToken = getResourceAccessVisitorToken(req)
  if (existingVisitorToken) {
    return {
      actorType: 'visitor',
      uid: 0,
      visitorToken: existingVisitorToken,
      ipHash: '',
      shouldSetVisitorCookie: false
    }
  }

  return {
    actorType: 'visitor',
    uid: 0,
    visitorToken: randomUUID(),
    ipHash: getResourceAccessIpHash(req),
    shouldSetVisitorCookie: true
  }
}

export const getResourceAccessActorKey = (actor: ResourceAccessActor) =>
  actor.actorType === 'user'
    ? `user:${actor.uid}`
    : `visitor:${actor.visitorToken}`

export const getResourceAccessViewerKey = (viewer: ResourceAccessViewer) =>
  viewer.uid > 0
    ? `user:${viewer.uid}`
    : viewer.visitorToken
      ? `visitor:${viewer.visitorToken}`
      : null

export const getResourceAccessActorWhere = (
  actor: ResourceAccessActor
): Prisma.patch_resource_accessWhereInput =>
  actor.actorType === 'user'
    ? { actor_type: 'user', user_id: actor.uid }
    : { actor_type: 'visitor', visitor_token: actor.visitorToken }

export const getResourceAccessViewerWhere = (
  viewer: ResourceAccessViewer
): Prisma.patch_resource_accessWhereInput | null =>
  viewer.uid > 0
    ? { actor_type: 'user', user_id: viewer.uid }
    : viewer.visitorToken
      ? { actor_type: 'visitor', visitor_token: viewer.visitorToken }
      : null

export const setResourceAccessVisitorCookie = (
  response: NextResponse,
  visitorToken: string
) => {
  response.cookies.set(RESOURCE_ACCESS_VISITOR_COOKIE, visitorToken, {
    ...kunCookieOptions(RESOURCE_ACCESS_VISITOR_COOKIE_MAX_AGE_SECONDS),
    path: '/'
  })
}
