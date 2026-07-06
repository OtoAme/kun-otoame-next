import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { kunCookieOptions } from '~/app/api/utils/cookieOptions'
import { parseCookies } from '~/utils/cookies'
import type { NextRequest } from 'next/server'

export const RESOURCE_ACCESS_VISITOR_COOKIE = 'kun-resource-access-token'
export const RESOURCE_ACCESS_REUSE_MS = 72 * 60 * 60 * 1000
const RESOURCE_ACCESS_VISITOR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180

export type ResourceAccessActor =
  | {
      actorType: 'user'
      uid: number
      visitorToken: ''
      shouldSetVisitorCookie: false
    }
  | {
      actorType: 'visitor'
      uid: 0
      visitorToken: string
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
      shouldSetVisitorCookie: false
    }
  }

  const existingVisitorToken = getResourceAccessVisitorToken(req)
  if (existingVisitorToken) {
    return {
      actorType: 'visitor',
      uid: 0,
      visitorToken: existingVisitorToken,
      shouldSetVisitorCookie: false
    }
  }

  return {
    actorType: 'visitor',
    uid: 0,
    visitorToken: randomUUID(),
    shouldSetVisitorCookie: true
  }
}

export const setResourceAccessVisitorCookie = (
  response: NextResponse,
  visitorToken: string
) => {
  response.cookies.set(
    RESOURCE_ACCESS_VISITOR_COOKIE,
    visitorToken,
    {
      ...kunCookieOptions(RESOURCE_ACCESS_VISITOR_COOKIE_MAX_AGE_SECONDS),
      path: '/'
    }
  )
}
