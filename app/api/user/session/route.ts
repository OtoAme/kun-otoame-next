import { NextRequest, NextResponse } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { getUnreadMessageStatus } from '~/app/api/message/unread/service'
import { getStatus } from '~/app/api/user/status/service'
import { PERSONALIZED_API_CACHE_CONTROL } from '~/app/api/utils/cacheHeaders'
import { checkConversationActionRateLimit } from '~/app/api/message/conversation/rateLimit'
import { SessionUnavailableError } from '~/app/api/utils/jwt'
import { getSessionContext } from '~/app/api/utils/sessionIdentity'
import { clearSessionCookies } from '~/app/api/utils/sessionCookies'
import type { UserSession } from '~/types/api/session'
import type { MessageUnreadStatus } from '~/types/api/message'

const jsonNoStore = (body: unknown) =>
  NextResponse.json(body, {
    headers: {
      'Cache-Control': PERSONALIZED_API_CACHE_CONTROL
    }
  })

const getSessionUnreadStatus = async (
  uid: number
): Promise<MessageUnreadStatus | null> => {
  const rateLimit = await checkConversationActionRateLimit(
    'notification-read',
    uid
  )
  if (!rateLimit.allowed) {
    return null
  }

  return getUnreadMessageStatus(uid)
}

export const GET = async (req: NextRequest) => {
  let payload
  try {
    payload = await verifyHeaderCookie(req)
  } catch (error) {
    if (!(error instanceof SessionUnavailableError)) throw error
    return NextResponse.json(
      { code: 'SESSION_UNAVAILABLE', message: error.message },
      {
        status: 503,
        headers: { 'Cache-Control': PERSONALIZED_API_CACHE_CONTROL }
      }
    )
  }
  if (!payload) {
    return clearSessionCookies(
      NextResponse.json(
        { code: 'SESSION_INVALID', message: '用户登录失效' },
        {
          status: 401,
          headers: { 'Cache-Control': PERSONALIZED_API_CACHE_CONTROL }
        }
      )
    )
  }

  const [userResult, unreadResult] = await Promise.allSettled([
    getStatus(payload.uid),
    getSessionUnreadStatus(payload.uid)
  ])
  if (userResult.status === 'rejected') {
    return NextResponse.json(
      {
        code: 'SESSION_UNAVAILABLE',
        message: '会话资料暂时不可用，请稍后重试'
      },
      {
        status: 503,
        headers: { 'Cache-Control': PERSONALIZED_API_CACHE_CONTROL }
      }
    )
  }

  const user = userResult.value
  if (typeof user === 'string') {
    return clearSessionCookies(
      NextResponse.json(
        { code: 'SESSION_INVALID', message: user },
        {
          status: 401,
          headers: { 'Cache-Control': PERSONALIZED_API_CACHE_CONTROL }
        }
      )
    )
  }

  const unread = unreadResult.status === 'fulfilled' ? unreadResult.value : null

  const response: UserSession = {
    user,
    unread,
    context: getSessionContext(payload)
  }
  return jsonNoStore(response)
}
