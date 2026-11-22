import { NextRequest, NextResponse } from 'next/server'
import { getRequestIdentity } from '~/app/api/utils/sessionIdentity'
import { PERSONALIZED_API_CACHE_CONTROL } from '~/app/api/utils/cacheHeaders'
import { getUnreadMessageStatus } from '~/app/api/message/unread/service'
import { markConversationAsRead } from '../service'
import {
  getConversationRetryAfterSeconds,
  isConversationRateLimitResponse,
  isConversationError
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

  if (isConversationError(body))
    return jsonNoStore(body, { status: body.status })
  return jsonNoStore(body, { status: typeof body === 'string' ? 400 : 200 })
}

export const PUT = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params
  const conversationId = parseConversationRouteId(id)
  if (conversationId === null) {
    return jsonNoStore('无效的会话 ID', { status: 400 })
  }

  let identity
  try {
    identity = await getRequestIdentity(req)
  } catch {
    return jsonNoStore(
      { code: 'SESSION_UNAVAILABLE', message: '会话暂时不可用' },
      { status: 503 }
    )
  }
  if (identity.status === 'unavailable')
    return jsonNoStore(
      { code: 'SESSION_UNAVAILABLE', message: '会话暂时不可用' },
      { status: 503 }
    )
  if (identity.status === 'guest')
    return jsonNoStore(
      { code: 'SESSION_INVALID', message: '用户登录失效' },
      { status: 401 }
    )
  const payload = identity.payload

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
  if (typeof readResponse === 'string' || isConversationError(readResponse)) {
    return jsonConversationReadResponse(readResponse)
  }

  const response = await getUnreadMessageStatus(payload.uid)
  return jsonNoStore({ ...response, readThroughId: readResponse.readThroughId })
}
