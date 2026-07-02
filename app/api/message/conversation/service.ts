import { z } from 'zod'
import { prisma } from '~/prisma/index'
import {
  createConversationSchema,
  getConversationsSchema
} from '~/validations/conversation'
import type { Conversation, PrivateMessageImage } from '~/types/api/conversation'

const isPrivateMessageImage = (
  value: unknown
): value is PrivateMessageImage => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const image = value as Record<string, unknown>
  return (
    typeof image.url === 'string' &&
    typeof image.width === 'number' &&
    typeof image.height === 'number' &&
    typeof image.size === 'number' &&
    typeof image.mime === 'string' &&
    typeof image.name === 'string'
  )
}

const summarizeConversationLastMessage = (
  message?: {
    type: number
    content: string
    image_url: string | null
    image_group?: unknown
    is_deleted: boolean
  }
) => {
  if (!message) {
    return ''
  }

  if (message.is_deleted) {
    return '消息已删除'
  }

  const content = message.content.trim()
  if (content) {
    return content
  }

  const hasImageGroup =
    Array.isArray(message.image_group) &&
    message.image_group.some(isPrivateMessageImage)
  if (hasImageGroup || message.image_url) {
    return '[图片]'
  }

  return message.type === 1 ? '[图片不可用]' : ''
}

export const getConversations = async (
  input: z.infer<typeof getConversationsSchema>,
  uid: number
) => {
  const { page, limit } = input
  const offset = (page - 1) * limit

  const [data, total] = await Promise.all([
    prisma.user_conversation.findMany({
      where: {
        OR: [
          { user_a_id: uid, user_a_hidden: false },
          { user_b_id: uid, user_b_hidden: false }
        ]
      },
      include: {
        user_a: {
          select: { id: true, name: true, avatar: true }
        },
        user_b: {
          select: { id: true, name: true, avatar: true }
        },
        messages: {
          orderBy: { created: 'desc' },
          take: 1,
          select: {
            type: true,
            content: true,
            image_url: true,
            image_group: true,
            is_deleted: true
          }
        }
      },
      orderBy: { last_message_time: 'desc' },
      skip: offset,
      take: limit
    }),
    prisma.user_conversation.count({
      where: {
        OR: [
          { user_a_id: uid, user_a_hidden: false },
          { user_b_id: uid, user_b_hidden: false }
        ]
      }
    })
  ])

  const conversations: Conversation[] = data.map((conv) => ({
    id: conv.id,
    otherUser: conv.user_a_id === uid ? conv.user_b : conv.user_a,
    lastMessage: summarizeConversationLastMessage(conv.messages[0]),
    lastMessageTime: conv.last_message_time,
    unreadCount:
      conv.user_a_id === uid ? conv.user_a_unread_count : conv.user_b_unread_count
  }))

  return { conversations, total }
}

const MOEMOEPOINT_REQUIRED = 20
const MOEMOEPOINT_COST = 10
const NEW_CONVERSATION_COST_ERROR = `萌萌点不足，开启新私聊需要消耗 ${MOEMOEPOINT_COST} 萌萌点`

const isUniqueConstraintError = (error: unknown) =>
  Boolean(error && typeof error === 'object' && 'code' in error) &&
  (error as { code?: unknown }).code === 'P2002'

const findConversationByPair = (userAId: number, userBId: number) =>
  prisma.user_conversation.findUnique({
    where: {
      user_a_id_user_b_id: { user_a_id: userAId, user_b_id: userBId }
    }
  })

export const checkConversation = async (
  input: z.infer<typeof createConversationSchema>,
  uid: number,
  role: number
) => {
  const { targetUserId } = input

  if (targetUserId === uid) {
    return { error: '不能和自己创建会话' }
  }

  const [currentUser, targetUser] = await Promise.all([
    prisma.user.findUnique({
      where: { id: uid },
      select: { moemoepoint: true }
    }),
    prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, name: true, allow_private_message: true }
    })
  ])

  if (!currentUser) {
    return { error: '用户不存在' }
  }
  if (!targetUser) {
    return { error: '目标用户不存在' }
  }
  if (!targetUser.allow_private_message) {
    return { error: '对方已关闭接收私信' }
  }

  const [userAId, userBId] =
    uid < targetUserId ? [uid, targetUserId] : [targetUserId, uid]

  const conversation = await findConversationByPair(userAId, userBId)

  if (conversation) {
    return {
      exists: true,
      conversationId: conversation.id,
      needsPayment: false,
      targetUserName: targetUser.name
    }
  }

  const isPrivileged = role > 2
  const hasEnoughPoints = currentUser.moemoepoint >= MOEMOEPOINT_REQUIRED

  if (!isPrivileged && !hasEnoughPoints) {
    return {
      error: `萌萌点不足，发起私聊需要至少 ${MOEMOEPOINT_REQUIRED} 萌萌点`
    }
  }

  return {
    exists: false,
    needsPayment: !isPrivileged,
    cost: MOEMOEPOINT_COST,
    currentPoints: currentUser.moemoepoint,
    targetUserName: targetUser.name
  }
}

export const getOrCreateConversation = async (
  input: z.infer<typeof createConversationSchema>,
  uid: number,
  role: number
) => {
  const { targetUserId } = input

  if (targetUserId === uid) {
    return '不能和自己创建会话'
  }

  const [currentUser, targetUser] = await Promise.all([
    prisma.user.findUnique({
      where: { id: uid },
      select: { moemoepoint: true }
    }),
    prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, allow_private_message: true }
    })
  ])

  if (!currentUser) {
    return '用户不存在'
  }
  if (!targetUser) {
    return '目标用户不存在'
  }
  if (!targetUser.allow_private_message) {
    return '对方已关闭接收私信'
  }

  const [userAId, userBId] =
    uid < targetUserId ? [uid, targetUserId] : [targetUserId, uid]

  let conversation = await findConversationByPair(userAId, userBId)

  let isNew = !conversation
  const isPrivileged = role > 2

  if (conversation) {
    const isUserA = conversation.user_a_id === uid
    const isHidden = isUserA
      ? conversation.user_a_hidden
      : conversation.user_b_hidden

    if (isHidden) {
      await prisma.user_conversation.update({
        where: { id: conversation.id },
        data: isUserA ? { user_a_hidden: false } : { user_b_hidden: false }
      })
    }
  } else {
    if (!isPrivileged) {
      if (currentUser.moemoepoint < MOEMOEPOINT_REQUIRED) {
        return `萌萌点不足，发起私聊需要至少 ${MOEMOEPOINT_REQUIRED} 萌萌点`
      }

      if (currentUser.moemoepoint < MOEMOEPOINT_COST) {
        return NEW_CONVERSATION_COST_ERROR
      }

      try {
        conversation = await prisma.$transaction(async (tx) => {
          const charged = await tx.user.updateMany({
            where: { id: uid, moemoepoint: { gte: MOEMOEPOINT_COST } },
            data: { moemoepoint: { decrement: MOEMOEPOINT_COST } }
          })
          if (charged.count === 0) {
            return null
          }

          return tx.user_conversation.create({
            data: { user_a_id: userAId, user_b_id: userBId }
          })
        })
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error
        }

        conversation = await findConversationByPair(userAId, userBId)
        if (conversation) {
          isNew = false
        }
      }

      if (!conversation) {
        return NEW_CONVERSATION_COST_ERROR
      }
    } else {
      try {
        conversation = await prisma.user_conversation.create({
          data: { user_a_id: userAId, user_b_id: userBId }
        })
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error
        }

        conversation = await findConversationByPair(userAId, userBId)
        if (conversation) {
          isNew = false
        }
      }
    }
  }

  if (!conversation) {
    return '会话创建失败，请稍后重试'
  }

  return { conversationId: conversation.id, isNew }
}
