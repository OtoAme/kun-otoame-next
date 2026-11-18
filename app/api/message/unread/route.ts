import { NextRequest, NextResponse } from 'next/server'
import { getRequestIdentity } from '~/app/api/utils/sessionIdentity'
import { PERSONALIZED_API_CACHE_CONTROL } from '~/app/api/utils/cacheHeaders'
import { getUnreadStatus } from '../service'
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
  let identity
  try {
    identity = await getRequestIdentity(req)
  } catch {
    return jsonNoStore(
      { code: 'SESSION_UNAVAILABLE', message: '会话暂时不可用' },
      { status: 503 }
    )
  }
  if (identity.status === 'unavailable') {
    return jsonNoStore(
      { code: 'SESSION_UNAVAILABLE', message: '会话暂时不可用' },
      { status: 503 }
    )
  }
  if (identity.status === 'guest') {
    return jsonNoStore(
      { code: 'SESSION_INVALID', message: '用户登录失效' },
      { status: 401 }
    )
  }
  const payload = identity.payload

  try {
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

    const response = await getUnreadStatus(payload.uid)
    return jsonNoStore(response)
  } catch {
    return jsonNoStore(
      { code: 'MESSAGE_SYNC_UNAVAILABLE', message: '消息同步暂时不可用' },
      { status: 503 }
    )
  }
}
