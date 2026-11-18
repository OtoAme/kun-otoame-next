import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { sliceUntilDelimiterFromEnd } from '~/app/api/utils/sliceUntilDelimiterFromEnd'
import {
  createMessage,
  lockNotificationAccounts
} from '~/app/api/utils/message'
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
      where: { type: 'feedback', sender_id: { not: null }, recipient_id: null },
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
      where: { type: 'feedback', sender_id: { not: null }, recipient_id: null }
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
  input: z.infer<typeof adminHandleFeedbackSchema>,
  actorId: number
) =>
  prisma.$transaction(async (transaction) => {
    const candidate = await transaction.user_message.findUnique({
      where: { id: input.messageId }
    })
    if (
      !candidate ||
      candidate.type !== 'feedback' ||
      candidate.recipient_id !== null ||
      candidate.sender_id === null
    )
      return '未找到该反馈'
    if (candidate.status !== 0) return '该反馈已被处理'
    const accounts = await lockNotificationAccounts(transaction, [
      actorId,
      candidate.sender_id
    ])
    if (!accounts.has(candidate.sender_id)) return '未找到该反馈'
    const claimed = await transaction.user_message.updateMany({
      where: {
        id: input.messageId,
        type: 'feedback',
        recipient_id: null,
        sender_id: candidate.sender_id,
        status: 0
      },
      data: { status: 1 }
    })
    if (claimed.count !== 1) return '该反馈已被处理'
    const message = await transaction.user_message.findUniqueOrThrow({
      where: { id: input.messageId }
    })
    const content = sliceUntilDelimiterFromEnd(message.content).slice(0, 200)
    const handleResult = input.content || '无处理留言'
    const feedbackContent = `您的反馈已处理!\n\n反馈原因: ${content}\n反馈处理回复: ${handleResult}`

    await createMessage(
      {
        event_type: 'feedback-result',
        actor_id: actorId,
        type: 'system',
        content: feedbackContent,
        recipient_id: candidate.sender_id,
        link: '/'
      },
      transaction
    )

    return {}
  })
