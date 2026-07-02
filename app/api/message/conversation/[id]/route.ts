import { NextRequest, NextResponse } from 'next/server'
import { kunParseGetQuery, kunParsePostBody } from '~/app/api/utils/parseQuery'
import { PERSONALIZED_API_CACHE_CONTROL } from '~/app/api/utils/cacheHeaders'
import {
  getConversationMessagesSchema,
  sendPrivateMessageSchema,
  updatePrivateMessageSchema,
  deletePrivateMessageSchema
} from '~/validations/conversation'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
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
  isConversationRateLimitResponse
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

  return jsonNoStore(body)
}

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params
  const conversationId = parseConversationRouteId(id)
  if (conversationId === null) {
    return jsonNoStore('无效的会话 ID')
  }

  const input = kunParseGetQuery(req, getConversationMessagesSchema)
  if (typeof input === 'string') {
    return jsonNoStore(input)
  }

  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return jsonNoStore('用户未登录')
  }

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
  return jsonNoStore(response)
}

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params
  const conversationId = parseConversationRouteId(id)
  if (conversationId === null) {
    return jsonNoStore('无效的会话 ID')
  }

  const input = await kunParsePostBody(req, sendPrivateMessageSchema)
  if (typeof input === 'string') {
    return jsonNoStore(input)
  }

  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return jsonNoStore('用户未登录')
  }

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
    return jsonNoStore('无效的会话 ID')
  }

  const input = await kunParsePostBody(req, updatePrivateMessageSchema)
  if (typeof input === 'string') {
    return jsonNoStore(input)
  }

  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return jsonNoStore('用户未登录')
  }

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
    return jsonNoStore('无效的会话 ID')
  }

  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return jsonNoStore('用户未登录')
  }

  const { searchParams } = new URL(req.url)

  if (searchParams.has('messageId')) {
    const input = kunParseGetQuery(req, deletePrivateMessageSchema)
    if (typeof input === 'string') {
      return jsonNoStore(input)
    }

    const response = await deleteMessage(conversationId, input, payload.uid)
    return jsonConversationResponse(response)
  }

  if (searchParams.get('action') !== 'conversation') {
    return jsonNoStore('无效的删除操作类型')
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
