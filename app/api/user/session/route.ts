import { NextRequest, NextResponse } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { getUnreadMessageStatus } from '~/app/api/message/unread/service'
import { getStatus } from '~/app/api/user/status/service'
import { PERSONALIZED_API_CACHE_CONTROL } from '~/app/api/utils/cacheHeaders'
import { checkConversationActionRateLimit } from '~/app/api/message/conversation/rateLimit'
import type { UserSession } from '~/types/api/session'
import type { MessageUnreadStatus } from '~/types/api/message'

const emptyUnreadStatus: NonNullable<UserSession['unread']> = {
  hasUnreadNotification: false,
  hasUnreadConversation: false
}

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
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return jsonNoStore('用户登陆失效')
  }

  const [userResult, unreadResult] = await Promise.allSettled([
    getStatus(payload.uid),
    getSessionUnreadStatus(payload.uid)
  ])
  if (userResult.status === 'rejected') {
    throw userResult.reason
  }

  const user = userResult.value
  if (typeof user === 'string') {
    return jsonNoStore(user)
  }

  const unread =
    unreadResult.status === 'fulfilled' ? unreadResult.value : emptyUnreadStatus

  const response: UserSession = { user, unread }
  return jsonNoStore(response)
}
