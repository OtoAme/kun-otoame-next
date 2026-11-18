import { NextRequest, NextResponse } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { PERSONALIZED_API_CACHE_CONTROL } from '~/app/api/utils/cacheHeaders'
import { getMessageSchema } from '~/validations/message'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { getMessage } from '../service'
import { NotificationServiceError } from '../errors'
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

export const GET = async (req: NextRequest) => {
  try {
    const input = kunParseGetQuery(req, getMessageSchema)
    if (typeof input === 'string') {
      return jsonNoStore(input, { status: 400 })
    }
    const payload = await verifyHeaderCookie(req)
    if (!payload) {
      return jsonNoStore('用户未登录', { status: 401 })
    }

    const rateLimit = await checkConversationActionRateLimit(
      'notification-read',
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

    return jsonNoStore(await getMessage(input, payload.uid))
  } catch (error) {
    return jsonNoStore(
      {
        code:
          error instanceof NotificationServiceError
            ? error.code
            : 'NOTIFICATION_UNAVAILABLE',
        message:
          error instanceof NotificationServiceError
            ? error.message
            : '通知服务暂不可用，请稍后重试'
      },
      { status: error instanceof NotificationServiceError ? error.status : 503 }
    )
  }
}
