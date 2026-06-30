import { z } from 'zod'
import { prisma } from '~/prisma/index'
import {
  deletePrivateMessageSchema,
  getConversationMessagesSchema,
  sendPrivateMessageSchema,
  updatePrivateMessageSchema
} from '~/validations/conversation'
import type { PrivateMessage } from '~/types/api/conversation'

type PrivateMessageRecord = {
  id: number
  type?: number
  content: string
  status: number
  is_deleted: boolean
  edited_at: Date | null
  image_url?: string | null
  image_width?: number | null
  image_height?: number | null
  image_size?: number | null
  image_mime?: string | null
  image_name?: string | null
  reply_to_message_id?: number | null
  reply_preview_content?: string | null
  reply_preview_sender_name?: string | null
  reply_selected_text?: string | null
  created: Date
  sender: KunUser
}

const mapPrivateMessage = (msg: PrivateMessageRecord): PrivateMessage => ({
  id: msg.id,
  type: msg.type ?? 0,
  content: msg.content,
  status: msg.status,
  isDeleted: msg.is_deleted,
  image: msg.image_url
    ? {
        url: msg.image_url,
        width: msg.image_width ?? 0,
        height: msg.image_height ?? 0,
        size: msg.image_size ?? 0,
        mime: msg.image_mime ?? 'image/jpeg',
        name: msg.image_name ?? 'image'
      }
    : null,
  replyTo:
    msg.reply_to_message_id && msg.reply_preview_sender_name
      ? {
          messageId: msg.reply_to_message_id,
          content: msg.reply_preview_content ?? '',
          senderName: msg.reply_preview_sender_name,
          selectedText: msg.reply_selected_text ?? null
        }
      : null,
  editedAt: msg.edited_at,
  created: msg.created,
  sender: msg.sender
})

const buildReplyPreview = async (
  conversationId: number,
  replyToMessageId?: number,
  replySelectedText?: string
) => {
  if (!replyToMessageId) {
    return null
  }

  const replyTarget = await prisma.user_private_message.findFirst({
    where: { id: replyToMessageId, conversation_id: conversationId },
    include: { sender: { select: { name: true } } }
  })

  if (!replyTarget) {
    return '回复的消息不存在'
  }

  if (replyTarget.is_deleted) {
    return '无法回复已删除的消息'
  }

  const selected = replySelectedText?.trim().slice(0, 500) || null
  const targetContent = replyTarget.content.trim()
  const fallback =
    replyTarget.type === 1 && !targetContent
      ? '[图片]'
      : targetContent.slice(0, 500)

  return {
    reply_to_message_id: replyTarget.id,
    reply_preview_content: selected ?? fallback,
    reply_preview_sender_name: replyTarget.sender.name,
    reply_selected_text: selected
  }
}

const verifyConversationAccess = async (
  conversationId: number,
  uid: number
) => {
  const conversation = await prisma.user_conversation.findUnique({
    where: { id: conversationId },
    include: {
      user_a: { select: { id: true, name: true, avatar: true } },
      user_b: { select: { id: true, name: true, avatar: true } }
    }
  })

  if (!conversation) {
    return null
  }

  if (conversation.user_a_id !== uid && conversation.user_b_id !== uid) {
    return null
  }

  return conversation
}

export const getConversationMessages = async (
  conversationId: number,
  input: z.infer<typeof getConversationMessagesSchema>,
  uid: number
) => {
  const conversation = await verifyConversationAccess(conversationId, uid)
  if (!conversation) {
    return '会话不存在或无权访问'
  }

  const { page, limit, beforeId, afterId } = input
  const offset = (page - 1) * limit
  const otherUser =
    conversation.user_a_id === uid ? conversation.user_b : conversation.user_a

  if (afterId) {
    const data = await prisma.user_private_message.findMany({
      where: { conversation_id: conversationId, id: { gt: afterId } },
      include: {
        sender: {
          select: { id: true, name: true, avatar: true }
        }
      },
      orderBy: { created: 'asc' },
      take: limit
    })

    const messages = [...data]
      .sort(
        (a, b) =>
          new Date(a.created).getTime() - new Date(b.created).getTime()
      )
      .map(mapPrivateMessage)
    return {
      messages,
      total: messages.length,
      hasMoreBefore: false,
      otherUser
    }
  }

  if (beforeId) {
    const data = await prisma.user_private_message.findMany({
      where: { conversation_id: conversationId, id: { lt: beforeId } },
      include: {
        sender: {
          select: { id: true, name: true, avatar: true }
        }
      },
      orderBy: { id: 'desc' },
      take: limit + 1
    })

    const hasMoreBefore = data.length > limit
    const messages = data.slice(0, limit).reverse().map(mapPrivateMessage)
    return {
      messages,
      total: messages.length,
      hasMoreBefore,
      otherUser
    }
  }

  const [data, total] = await Promise.all([
    prisma.user_private_message.findMany({
      where: { conversation_id: conversationId },
      include: {
        sender: {
          select: { id: true, name: true, avatar: true }
        }
      },
      orderBy: { created: 'desc' },
      skip: offset,
      take: limit
    }),
    prisma.user_private_message.count({
      where: { conversation_id: conversationId }
    })
  ])

  const messages = data.map(mapPrivateMessage)

  return {
    messages,
    total,
    hasMoreBefore: offset + data.length < total,
    otherUser
  }
}

export const sendMessage = async (
  conversationId: number,
  input: z.infer<typeof sendPrivateMessageSchema>,
  uid: number
) => {
  const conversation = await verifyConversationAccess(conversationId, uid)
  if (!conversation) {
    return '会话不存在或无权访问'
  }

  const { content = '', image, replyToMessageId, replySelectedText } = input
  const type = input.type ?? 0
  const replyPreview = await buildReplyPreview(
    conversationId,
    replyToMessageId,
    replySelectedText
  )

  if (typeof replyPreview === 'string') {
    return replyPreview
  }

  const isUserA = conversation.user_a_id === uid
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.user_private_message.create({
      data: {
        conversation_id: conversationId,
        sender_id: uid,
        type,
        content,
        image_url: image?.url,
        image_width: image?.width,
        image_height: image?.height,
        image_size: image?.size,
        image_mime: image?.mime,
        image_name: image?.name,
        ...(replyPreview ?? {})
      },
      include: {
        sender: {
          select: { id: true, name: true, avatar: true }
        }
      }
    })

    await tx.user_conversation.update({
      where: { id: conversationId },
      data: {
        last_message_id: created.id,
        last_message_time: created.created,
        ...(isUserA
          ? { user_b_unread_count: { increment: 1 } }
          : { user_a_unread_count: { increment: 1 } })
      }
    })

    return created
  })

  return mapPrivateMessage({
    id: message.id,
    type: message.type,
    content: message.content,
    status: message.status,
    is_deleted: message.is_deleted,
    edited_at: message.edited_at,
    image_url: message.image_url,
    image_width: message.image_width,
    image_height: message.image_height,
    image_size: message.image_size,
    image_mime: message.image_mime,
    image_name: message.image_name,
    reply_to_message_id: message.reply_to_message_id,
    reply_preview_content: message.reply_preview_content,
    reply_preview_sender_name: message.reply_preview_sender_name,
    reply_selected_text: message.reply_selected_text,
    created: message.created,
    sender: message.sender
  })
}

export const updateMessage = async (
  conversationId: number,
  input: z.infer<typeof updatePrivateMessageSchema>,
  uid: number
) => {
  const conversation = await verifyConversationAccess(conversationId, uid)
  if (!conversation) {
    return '会话不存在或无权访问'
  }

  const { messageId, content } = input

  const message = await prisma.user_private_message.findFirst({
    where: {
      id: messageId,
      conversation_id: conversationId
    }
  })

  if (!message) {
    return '消息不存在'
  }

  if (message.sender_id !== uid) {
    return '只能编辑自己的消息'
  }

  if (message.is_deleted) {
    return '无法编辑已删除的消息'
  }

  const updated = await prisma.user_private_message.update({
    where: { id: messageId },
    data: {
      content,
      edited_at: new Date()
    }
  })

  return {
    id: updated.id,
    content: updated.content,
    editedAt: updated.edited_at
  }
}

export const deleteMessage = async (
  conversationId: number,
  input: z.infer<typeof deletePrivateMessageSchema>,
  uid: number
) => {
  const conversation = await verifyConversationAccess(conversationId, uid)
  if (!conversation) {
    return '会话不存在或无权访问'
  }

  const { messageId } = input

  const message = await prisma.user_private_message.findFirst({
    where: {
      id: messageId,
      conversation_id: conversationId
    }
  })

  if (!message) {
    return '消息不存在'
  }

  if (message.sender_id !== uid) {
    return '只能删除自己的消息'
  }

  await prisma.user_private_message.update({
    where: { id: messageId },
    data: { is_deleted: true }
  })

  return {}
}

export const markConversationAsRead = async (
  conversationId: number,
  uid: number
) => {
  const conversation = await prisma.user_conversation.findUnique({
    where: { id: conversationId }
  })

  if (!conversation) {
    return '会话不存在'
  }

  if (conversation.user_a_id !== uid && conversation.user_b_id !== uid) {
    return '无权访问此会话'
  }

  const isUserA = conversation.user_a_id === uid

  await prisma.user_private_message.updateMany({
    where: {
      conversation_id: conversationId,
      sender_id: isUserA ? conversation.user_b_id : conversation.user_a_id,
      status: 0
    },
    data: { status: 1 }
  })

  await prisma.user_conversation.update({
    where: { id: conversationId },
    data: isUserA ? { user_a_unread_count: 0 } : { user_b_unread_count: 0 }
  })

  return {}
}

export const deleteConversation = async (
  conversationId: number,
  uid: number
) => {
  const conversation = await verifyConversationAccess(conversationId, uid)
  if (!conversation) {
    return '会话不存在或无权访问'
  }

  await prisma.user_conversation.delete({
    where: { id: conversationId }
  })

  return {}
}
