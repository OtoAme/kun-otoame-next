import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { sliceUntilDelimiterFromEnd } from '~/app/api/utils/sliceUntilDelimiterFromEnd'
import { createMessage } from '~/app/api/utils/message'
import {
  adminHandleFeedbackSchema,
  adminPaginationSchema
} from '~/validations/admin'
import type { Message } from '~/types/api/message'

export const getFeedback = async (
  input: z.infer<typeof adminPaginationSchema>
) => {
  const { page, limit } = input
  const offset = (page - 1) * limit

  const [data, total] = await Promise.all([
    prisma.user_message.findMany({
      where: { type: 'feedback', sender_id: { not: null } },
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
    prisma.user_message.count({
      where: { type: 'feedback', sender_id: { not: null } }
    })
  ])

  const feedbacks: Message[] = data.map((msg) => ({
    id: msg.id,
    type: msg.type,
    content: msg.content,
    status: msg.status,
    link: msg.link,
    created: msg.created,
    sender: msg.sender
  }))

  return { feedbacks, total }
}

export const handleFeedback = async (
  input: z.infer<typeof adminHandleFeedbackSchema>
) => {
  const message = await prisma.user_message.findUnique({
    where: { id: input.messageId }
  })
  if (message?.status) {
    return '该反馈已被处理'
  }

  const SLICED_CONTENT = sliceUntilDelimiterFromEnd(message?.content).slice(
    0,
    200
  )
  const handleResult = input.content ? input.content : '无处理留言'
  const feedbackContent = `您的反馈已处理!\n\n反馈原因: ${SLICED_CONTENT}\n反馈处理回复: ${handleResult}`

  return prisma.$transaction(async (prisma) => {
    await prisma.user_message.update({
      where: { id: input.messageId },
      // status: 0 - unread, 1 - read, 2 - approve, 3 - decline
      data: { status: { set: 1 } }
    })

    await createMessage({
      type: 'feedback',
      content: feedbackContent,
      recipient_id: message?.sender_id ?? undefined,
      link: '/'
    })

    return {}
  })
}
