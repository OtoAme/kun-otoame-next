import { NextRequest, NextResponse } from 'next/server'
import { kunParseDeleteQuery } from '~/app/api/utils/parseQuery'
import { PERSONALIZED_API_CACHE_CONTROL } from '~/app/api/utils/cacheHeaders'
import { clearReadMessageSchema } from '~/validations/message'
import { readNotificationSchema } from '~/validations/notification'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { clearReadMessage, readMessage } from '../service'
import { NotificationServiceError } from '../error'
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
  try {
    const payload = await verifyHeaderCookie(req)
    if (!payload) {
      return jsonNoStore('用户未登录', { status: 401 })
    }

    const input = readNotificationSchema.safeParse(
      await req.json().catch(() => null)
    )
    if (!input.success)
      return jsonNoStore(
        {
          code: 'NOTIFICATION_SCOPE_REQUIRED',
          message: '请刷新通知页面，仅确认已经看到的通知'
        },
        { status: 409 }
      )

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

    return jsonNoStore(await readMessage(payload.uid, input.data))
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

export const DELETE = async (req: NextRequest) => {
  try {
    const input = kunParseDeleteQuery(req, clearReadMessageSchema)
    if (typeof input === 'string') {
      return jsonNoStore(input, { status: 400 })
    }

    const payload = await verifyHeaderCookie(req)
    if (!payload) {
      return jsonNoStore('用户未登录', { status: 401 })
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

    return jsonNoStore(
      await clearReadMessage(payload.uid, input.type, input.category)
    )
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
