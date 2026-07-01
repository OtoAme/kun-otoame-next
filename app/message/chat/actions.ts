'use server'

import { z } from 'zod'
import { safeParseSchema } from '~/utils/actions/safeParseSchema'
import {
  getConversationsSchema,
  getConversationMessagesSchema
} from '~/validations/conversation'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import { getConversations } from '~/app/api/message/conversation/service'
import { getConversationMessages } from '~/app/api/message/conversation/[id]/service'
import { checkConversationActionRateLimit } from '~/app/api/message/conversation/rateLimit'
import { parseConversationRouteId } from '~/app/api/message/conversation/routeParams'

export const kunGetConversationsAction = async (
  params: z.infer<typeof getConversationsSchema>
) => {
  const input = safeParseSchema(getConversationsSchema, params)
  if (typeof input === 'string') {
    return input
  }
  const payload = await verifyHeaderCookie()
  if (!payload) {
    return '用户登录失效'
  }

  const rateLimit = await checkConversationActionRateLimit(
    'message-read',
    payload.uid
  )
  if (!rateLimit.allowed) {
    return rateLimit.message
  }

  const response = await getConversations(input, payload.uid)
  return response
}

export const kunGetConversationMessagesAction = async (
  conversationId: number | string,
  params: z.infer<typeof getConversationMessagesSchema>
) => {
  const parsedConversationId = parseConversationRouteId(String(conversationId))
  if (parsedConversationId === null) {
    return '无效的会话 ID'
  }

  const input = safeParseSchema(getConversationMessagesSchema, params)
  if (typeof input === 'string') {
    return input
  }
  const payload = await verifyHeaderCookie()
  if (!payload) {
    return '用户登录失效'
  }

  const rateLimit = await checkConversationActionRateLimit(
    'message-read',
    payload.uid
  )
  if (!rateLimit.allowed) {
    return rateLimit.message
  }

  const response = await getConversationMessages(
    parsedConversationId,
    input,
    payload.uid
  )
  return response
}
