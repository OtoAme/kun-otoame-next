import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import {
  deletePrivateMessageSchema,
  getConversationMessagesSchema,
  sendPrivateMessageSchema,
  updatePrivateMessageSchema
} from '~/validations/conversation'
import type { PrivateMessage } from '~/types/api/conversation'
import type { PrivateMessageImage } from '~/types/api/conversation'
import { deleteFileFromS3 } from '~/lib/s3'
import {
  consumeConversationImageUploads,
  restoreConversationImageUploads
} from '../imageUploadMetadata'
import { createConversationRateLimitResponse } from '../response'

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
  image_group?: unknown
  reply_to_message_id?: number | null
  reply_preview_content?: string | null
  reply_preview_sender_name?: string | null
  reply_selected_text?: string | null
  reply_image?: unknown
  created: Date
  sender: KunUser
}

type PrivateMessageImageRecord = Pick<
  PrivateMessageRecord,
  | 'image_url'
  | 'image_width'
  | 'image_height'
  | 'image_size'
  | 'image_mime'
  | 'image_name'
  | 'image_group'
>

const CONVERSATION_IMAGE_KEY_PATTERN =
  /^conversation\/\d+\/\d+-\d+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.avif$/i

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

const toPrismaJsonImage = (
  image: PrivateMessageImage
): Prisma.InputJsonObject => ({
  url: image.url,
  width: image.width,
  height: image.height,
  size: image.size,
  mime: image.mime,
  name: image.name
})

const getMessageImages = (
  msg: PrivateMessageImageRecord
): PrivateMessageImage[] => {
  if (Array.isArray(msg.image_group)) {
    const images = msg.image_group.filter(isPrivateMessageImage)
    if (images.length > 0) {
      return images
    }
  }

  return msg.image_url
    ? [
        {
          url: msg.image_url,
          width: msg.image_width ?? 0,
          height: msg.image_height ?? 0,
          size: msg.image_size ?? 0,
          mime: msg.image_mime ?? 'image/jpeg',
          name: msg.image_name ?? 'image'
        }
      ]
    : []
}

const getS3UrlPrefixes = () =>
  [
    process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL,
    process.env.NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => `${value.replace(/\/+$/, '')}/`)

const extractConversationImageS3Key = (url: string) => {
  const prefix = getS3UrlPrefixes().find((item) => url.startsWith(item))
  if (!prefix) {
    console.error('[Conversation] Refused to delete image with invalid URL', {
      url
    })
    return null
  }

  const key = url.slice(prefix.length)
  if (!CONVERSATION_IMAGE_KEY_PATTERN.test(key)) {
    console.error('[Conversation] Refused to delete invalid image key', {
      key
    })
    return null
  }

  return key
}

const findReferencedConversationImageKeys = async (
  keys: string[],
  excludeMessageId: number
) => {
  if (keys.length === 0) {
    return new Set<string>()
  }

  const values = Prisma.join(keys.map((key) => Prisma.sql`(${key})`))
  const rows = await prisma.$queryRaw<{ key: string }[]>(Prisma.sql`
    WITH candidate(key) AS (VALUES ${values})
    SELECT key
    FROM candidate
    WHERE EXISTS (
      SELECT 1
      FROM user_private_message
      WHERE id <> ${excludeMessageId}
        AND is_deleted = false
        AND (
          image_url LIKE '%' || candidate.key || '%'
          OR image_group::text LIKE '%' || candidate.key || '%'
          OR reply_image::text LIKE '%' || candidate.key || '%'
        )
    )
  `)

  return new Set(rows.map((row) => row.key))
}

const deleteUnreferencedConversationImages = async (
  message: PrivateMessageImageRecord & { id: number }
) => {
  const keys = Array.from(
    new Set(
      getMessageImages(message)
        .map((image) => extractConversationImageS3Key(image.url))
        .filter((key): key is string => Boolean(key))
    )
  )
  if (keys.length === 0) {
    return
  }

  const referencedKeys = await findReferencedConversationImageKeys(
    keys,
    message.id
  )
  const keysToDelete = keys.filter((key) => !referencedKeys.has(key))

  const results = await Promise.allSettled(
    keysToDelete.map((key) => deleteFileFromS3(key))
  )
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      console.error('[Conversation] Failed to delete private message image', {
        messageId: message.id,
        key: keysToDelete[index],
        error: result.reason
      })
    }
  }
}

const mapPrivateMessage = (msg: PrivateMessageRecord): PrivateMessage => {
  if (msg.is_deleted) {
    return {
      id: msg.id,
      type: 0,
      content: '',
      status: msg.status,
      isDeleted: true,
      image: null,
      images: [],
      replyTo: null,
      editedAt: msg.edited_at,
      created: msg.created,
      sender: msg.sender
    }
  }

  const images = getMessageImages(msg)
  const messageType = msg.type ?? 0
  const missingImagePayload = messageType === 1 && images.length === 0
  const content = missingImagePayload
    ? msg.content.trim() || '[图片不可用]'
    : msg.content
  const replyImage = isPrivateMessageImage(msg.reply_image)
    ? msg.reply_image
    : null

  return {
    id: msg.id,
    type: missingImagePayload ? 0 : messageType,
    content,
    status: msg.status,
    isDeleted: msg.is_deleted,
    image: images[0] ?? null,
    images,
    replyTo:
      msg.reply_to_message_id && msg.reply_preview_sender_name
        ? {
            messageId: msg.reply_to_message_id,
            content: msg.reply_preview_content ?? '',
            senderName: msg.reply_preview_sender_name,
            selectedText: msg.reply_selected_text ?? null,
            image: replyImage
          }
        : null,
    editedAt: msg.edited_at,
    created: msg.created,
    sender: msg.sender
  }
}

const buildReplyPreview = async (
  conversationId: number,
  replyToMessageId?: number,
  replySelectedText?: string,
  replyImageIndex?: number
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
  const replyImages = getMessageImages(replyTarget)
  const replyImage =
    replyImageIndex === undefined
      ? null
      : (replyImages[replyImageIndex] ?? null)

  if (replyImageIndex !== undefined && !replyImage) {
    return '回复的图片不存在'
  }

  const targetContent = replyTarget.content.trim()
  const fallback =
    replyImage || (replyTarget.type === 1 && !targetContent)
      ? '[图片]'
      : targetContent.slice(0, 500)

  return {
    reply_to_message_id: replyTarget.id,
    reply_preview_content: selected ?? fallback,
    reply_preview_sender_name: replyTarget.sender.name,
    reply_selected_text: selected,
    reply_image: replyImage ? toPrismaJsonImage(replyImage) : undefined
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

const verifyRecipientAllowsPrivateMessage = async (
  recipientId: number,
  senderId: number
) => {
  if (recipientId === senderId) {
    return null
  }

  const recipient = await prisma.user.findUnique({
    where: { id: recipientId },
    select: { id: true, allow_private_message: true }
  })

  if (!recipient) {
    return '目标用户不存在'
  }

  return recipient.allow_private_message ? null : '对方已关闭接收私信'
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
        (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime()
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

  const messages = data.slice().reverse().map(mapPrivateMessage)

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

  const {
    content = '',
    image,
    images,
    replyToMessageId,
    replySelectedText,
    replyImageIndex
  } = input
  const type = input.type ?? 0
  const imageList = images ?? (image ? [image] : [])
  const firstImage = imageList[0]
  const recipientId =
    conversation.user_a_id === uid
      ? conversation.user_b_id
      : conversation.user_a_id
  const recipientError = await verifyRecipientAllowsPrivateMessage(
    recipientId,
    uid
  )
  if (recipientError) {
    return recipientError
  }

  const { checkConversationActionRateLimit } = await import('../rateLimit')
  const rateLimit = await checkConversationActionRateLimit('send', uid)
  if (!rateLimit.allowed) {
    return createConversationRateLimitResponse(
      rateLimit.message,
      rateLimit.retryAfterMs
    )
  }

  const replyPreview = await buildReplyPreview(
    conversationId,
    replyToMessageId,
    replySelectedText,
    replyImageIndex
  )

  if (typeof replyPreview === 'string') {
    return replyPreview
  }

  const imageUploadError = await consumeConversationImageUploads(
    conversationId,
    uid,
    imageList
  )
  if (imageUploadError) {
    return imageUploadError
  }

  const isUserA = conversation.user_a_id === uid
  const message = await (async () => {
    try {
      return await prisma.$transaction(async (tx) => {
        const created = await tx.user_private_message.create({
          data: {
            conversation_id: conversationId,
            sender_id: uid,
            type,
            content,
            image_url: firstImage?.url,
            image_width: firstImage?.width,
            image_height: firstImage?.height,
            image_size: firstImage?.size,
            image_mime: firstImage?.mime,
            image_name: firstImage?.name,
            image_group: imageList.length > 0 ? imageList : undefined,
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
            user_a_hidden: false,
            user_b_hidden: false,
            ...(isUserA
              ? { user_b_unread_count: { increment: 1 } }
              : { user_a_unread_count: { increment: 1 } })
          }
        })

        return created as typeof created & { sender: KunUser }
      })
    } catch (error) {
      try {
        await restoreConversationImageUploads(conversationId, uid, imageList)
      } catch (restoreError) {
        console.error('Failed to restore conversation image upload metadata', {
          conversationId,
          uid,
          error: restoreError
        })
      }

      throw error
    }
  })()

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
    image_group: message.image_group,
    reply_to_message_id: message.reply_to_message_id,
    reply_preview_content: message.reply_preview_content,
    reply_preview_sender_name: message.reply_preview_sender_name,
    reply_selected_text: message.reply_selected_text,
    reply_image: message.reply_image,
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

  const { checkConversationActionRateLimit } = await import('../rateLimit')
  const rateLimit = await checkConversationActionRateLimit(
    'message-write',
    uid
  )
  if (!rateLimit.allowed) {
    return createConversationRateLimitResponse(
      rateLimit.message,
      rateLimit.retryAfterMs
    )
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

  const { checkConversationActionRateLimit } = await import('../rateLimit')
  const rateLimit = await checkConversationActionRateLimit(
    'message-write',
    uid
  )
  if (!rateLimit.allowed) {
    return createConversationRateLimitResponse(
      rateLimit.message,
      rateLimit.retryAfterMs
    )
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

  if (message.is_deleted) {
    return {}
  }

  await prisma.user_private_message.update({
    where: { id: messageId },
    data: { is_deleted: true }
  })

  try {
    await deleteUnreferencedConversationImages(message)
  } catch (error) {
    console.error('[Conversation] Failed to cleanup private message images', {
      conversationId,
      messageId,
      error
    })
  }

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
  const unreadCount = isUserA
    ? conversation.user_a_unread_count
    : conversation.user_b_unread_count

  if (unreadCount === 0) {
    return {}
  }

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
  uid: number,
  options?: { skipRateLimit?: boolean }
) => {
  const conversation = await verifyConversationAccess(conversationId, uid)
  if (!conversation) {
    return '会话不存在或无权访问'
  }

  const isUserA = conversation.user_a_id === uid
  if (!options?.skipRateLimit) {
    const { checkConversationActionRateLimit } = await import('../rateLimit')
    const rateLimit = await checkConversationActionRateLimit(
      'conversation-manage',
      uid
    )
    if (!rateLimit.allowed) {
      return createConversationRateLimitResponse(
        rateLimit.message,
        rateLimit.retryAfterMs
      )
    }
  }

  const alreadyHidden = isUserA
    ? conversation.user_a_hidden
    : conversation.user_b_hidden
  const unreadCount = isUserA
    ? conversation.user_a_unread_count
    : conversation.user_b_unread_count

  if (alreadyHidden && unreadCount === 0) {
    return {}
  }

  await prisma.user_conversation.update({
    where: { id: conversationId },
    data: isUserA
      ? {
          user_a_hidden: true,
          user_a_unread_count: 0
        }
      : {
          user_b_hidden: true,
          user_b_unread_count: 0
        }
  })

  return {}
}
