import { NextRequest, NextResponse } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { PERSONALIZED_API_CACHE_CONTROL } from '~/app/api/utils/cacheHeaders'
import { getUnreadMessageStatus } from '~/app/api/message/unread/service'
import { markConversationAsRead } from '../service'
import {
  getConversationRetryAfterSeconds,
  isConversationRateLimitResponse
} from '../../response'
import { parseConversationRouteId } from '../../routeParams'

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

const jsonConversationReadResponse = (body: unknown) => {
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

export const PUT = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params
  const conversationId = parseConversationRouteId(id)
  if (conversationId === null) {
    return jsonNoStore('无效的会话 ID')
  }

  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return jsonNoStore('用户未登录')
  }

  const { checkConversationActionRateLimit } = await import('../../rateLimit')
  const rateLimit = await checkConversationActionRateLimit(
    'message-read',
    payload.uid
  )
  if (!rateLimit.allowed) {
    return jsonConversationReadResponse({
      kind: 'conversation-rate-limit',
      message: rateLimit.message,
      retryAfterMs: rateLimit.retryAfterMs
    })
  }

  const readResponse = await markConversationAsRead(conversationId, payload.uid)
  if (typeof readResponse === 'string') {
    return jsonNoStore(readResponse)
  }

  const response = await getUnreadMessageStatus(payload.uid)
  return jsonNoStore(response)
}
