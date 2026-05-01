import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { createMessage } from '~/app/api/utils/message'
import { createMessageSchema, getMessageSchema } from '~/validations/message'
import type { Message } from '~/types/api/message'

export const getUnreadStatus = async (uid: number) => {
  const [unreadMessage, unreadChat] = await Promise.all([
    prisma.user_message.findFirst({
      where: { recipient_id: uid, status: 0 },
      select: { id: true }
    }),
    prisma.user_conversation.findFirst({
      where: {
        OR: [
          { user_a_id: uid, user_a_unread_count: { gt: 0 } },
          { user_b_id: uid, user_b_unread_count: { gt: 0 } }
        ]
      },
      select: { id: true }
    })
  ])

  return {
    hasUnreadMessages: !!unreadMessage,
    hasUnreadChat: !!unreadChat
  }
}

export const readMessage = async (uid: number) => {
  await prisma.user_message.updateMany({
    where: { recipient_id: uid },
    data: { status: { set: 1 } }
  })
  return {}
}

export const getMessage = async (
  input: z.infer<typeof getMessageSchema>,
  uid: number
) => {
  const { type, page, limit } = input
  const offset = (page - 1) * limit

  const where = type
    ? { recipient_id: uid, type }
    : {
        recipient_id: uid
        // type: { in: ['like', 'favorite', 'comment', 'pr'] }
      }

  const [data, total] = await Promise.all([
    prisma.user_message.findMany({
      where,
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            avatar: true
          }
        }
      },
      orderBy: { created: 'desc' },
      skip: offset,
      take: limit
    }),
    prisma.user_message.count({ where })
  ])

  const messages: Message[] = data.map((msg) => ({
    id: msg.id,
    type: msg.type,
    content: msg.content,
    status: msg.status,
    link: msg.link,
    created: msg.created,
    sender: msg.sender
  }))

  return { messages, total }
}

export const create = async (
  input: z.infer<typeof createMessageSchema>,
  uid: number
) => {
  const { type, content, recipientId, link } = input

  const message = await createMessage({
    type,
    content,
    sender_id: uid,
    recipient_id: recipientId,
    link
  })

  return message
}
