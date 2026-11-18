import { NextRequest, NextResponse } from 'next/server'
import { kunParseGetQuery, kunParsePostBody } from '~/app/api/utils/parseQuery'
import { PERSONALIZED_API_CACHE_CONTROL } from '~/app/api/utils/cacheHeaders'
import {
  getConversationMessagesSchema,
  sendPrivateMessageSchema,
  updatePrivateMessageSchema,
  deletePrivateMessageSchema
} from '~/validations/conversation'
import { getRequestIdentity } from '~/app/api/utils/sessionIdentity'
import {
  deleteConversation,
  deleteMessage,
  getConversationMessages,
  sendMessage,
  updateMessage
} from './service'
import {
  createConversationRateLimitResponse,
  getConversationRetryAfterSeconds,
  isConversationRateLimitResponse,
  isConversationError
} from '../response'
import { parseConversationRouteId } from '../routeParams'

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

const jsonConversationResponse = (body: unknown) => {
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

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params
  const conversationId = parseConversationRouteId(id)
  if (conversationId === null) {
    return jsonNoStore('无效的会话 ID', { status: 400 })
  }

  const input = kunParseGetQuery(req, getConversationMessagesSchema)
  if (typeof input === 'string') {
    return jsonNoStore(input, { status: 400 })
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

  const { checkConversationActionRateLimit } = await import('../rateLimit')
  const rateLimit = await checkConversationActionRateLimit(
    'message-read',
    payload.uid
  )
  if (!rateLimit.allowed) {
    return jsonConversationResponse({
      kind: 'conversation-rate-limit',
      message: rateLimit.message,
      retryAfterMs: rateLimit.retryAfterMs
    })
  }

  const response = await getConversationMessages(
    conversationId,
    input,
    payload.uid
  )
  return jsonConversationResponse(response)
}

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params
  const conversationId = parseConversationRouteId(id)
  if (conversationId === null) {
    return jsonNoStore('无效的会话 ID', { status: 400 })
  }

  const input = await kunParsePostBody(req, sendPrivateMessageSchema)
  if (typeof input === 'string') {
    return jsonNoStore(input, { status: 400 })
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

  const response = await sendMessage(conversationId, input, payload.uid)
  return jsonConversationResponse(response)
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

  const input = await kunParsePostBody(req, updatePrivateMessageSchema)
  if (typeof input === 'string') {
    return jsonNoStore(input, { status: 400 })
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

  const response = await updateMessage(conversationId, input, payload.uid)
  return jsonConversationResponse(response)
}

export const DELETE = async (
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

  const { searchParams } = new URL(req.url)

  if (searchParams.has('messageId')) {
    const input = kunParseGetQuery(req, deletePrivateMessageSchema)
    if (typeof input === 'string') {
      return jsonNoStore(input, { status: 400 })
    }

    const response = await deleteMessage(conversationId, input, payload.uid)
    return jsonConversationResponse(response)
  }

  if (searchParams.get('action') !== 'conversation') {
    return jsonNoStore('无效的删除操作类型', { status: 400 })
  }

  const { checkConversationActionRateLimit } = await import('../rateLimit')
  const rateLimit = await checkConversationActionRateLimit(
    'conversation-manage',
    payload.uid
  )
  if (!rateLimit.allowed) {
    return jsonConversationResponse(
      createConversationRateLimitResponse(
        rateLimit.message,
        rateLimit.retryAfterMs
      )
    )
  }

  const response = await deleteConversation(conversationId, payload.uid, {
    skipRateLimit: true
  })
  return jsonConversationResponse(response)
}
