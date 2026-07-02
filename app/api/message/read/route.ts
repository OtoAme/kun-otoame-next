import { NextRequest, NextResponse } from 'next/server'
import { kunParseDeleteQuery } from '~/app/api/utils/parseQuery'
import { PERSONALIZED_API_CACHE_CONTROL } from '~/app/api/utils/cacheHeaders'
import { clearReadMessageSchema } from '~/validations/message'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { clearReadMessage, readMessage } from '../service'
import { getUnreadMessageStatus } from '../unread/service'
import { checkConversationActionRateLimit } from '../conversation/rateLimit'
import {
  createConversationRateLimitResponse,
  getConversationRetryAfterSeconds,
  isConversationRateLimitResponse
} from '../conversation/response'

const jsonNoStore = (
  body: unknown,
  init?: { status?: number; headers?: HeadersInit }
) =>
  NextResponse.json(body, {
    status: init?.status,
    headers: {
      'Cache-Control': PERSONALIZED_API_CACHE_CONTROL,
      ...init?.headers
    }
  })

const jsonNotificationResponse = (body: unknown) => {
  if (isConversationRateLimitResponse(body)) {
    return jsonNoStore(body.message, {
      status: 429,
      headers: {
        'Retry-After': getConversationRetryAfterSeconds(body.retryAfterMs)
      }
    })
  }

  return jsonNoStore(body)
}

export const PUT = async (req: NextRequest) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return jsonNoStore('用户未登录')
  }

  const rateLimit = await checkConversationActionRateLimit(
    'notification-write',
    payload.uid
  )
  if (!rateLimit.allowed) {
    return jsonNotificationResponse(
      createConversationRateLimitResponse(
        rateLimit.message,
        rateLimit.retryAfterMs
      )
    )
  }

  await readMessage(payload.uid)
  const response = await getUnreadMessageStatus(payload.uid)
  return jsonNoStore(response)
}

export const DELETE = async (req: NextRequest) => {
  const input = kunParseDeleteQuery(req, clearReadMessageSchema)
  if (typeof input === 'string') {
    return jsonNoStore(input)
  }

  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return jsonNoStore('用户未登录')
  }

  const rateLimit = await checkConversationActionRateLimit(
    'notification-write',
    payload.uid
  )
  if (!rateLimit.allowed) {
    return jsonNotificationResponse(
      createConversationRateLimitResponse(
        rateLimit.message,
        rateLimit.retryAfterMs
      )
    )
  }

  const response = await clearReadMessage(payload.uid, input.type)
  return jsonNoStore(response)
}
