import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { readAccountPreferenceVersion } from '~/lib/accountPreferences/version'
import {
  createMessage,
  lockNotificationAccounts
} from '~/app/api/utils/message'
import { createMessageSchema, getMessageSchema } from '~/validations/message'
import { readNotificationSchema } from '~/validations/notification'
import {
  notificationCategory,
  type NotificationCategory
} from '~/constants/notification'
import {
  notificationCategorySql,
  readNotificationSummary
} from './notificationQuery'
import type { Message, NotificationList } from '~/types/api/message'
import { NotificationServiceError } from './error'

const unreadConversation = (uid: number) =>
  prisma.user_conversation.findFirst({
    where: {
      OR: [
        {
          user_a_id: uid,
          user_a_hidden: false,
          user_a_unread_count: { gt: 0 }
        },
        { user_b_id: uid, user_b_hidden: false, user_b_unread_count: { gt: 0 } }
      ]
    },
    select: { id: true }
  })

export const getUnreadStatus = async (uid: number) => {
  const [notifications, conversation, preferenceVersion] = await Promise.all([
    readNotificationSummary(prisma, uid),
    unreadConversation(uid),
    readAccountPreferenceVersion(uid)
  ])
  return {
    hasUnreadMessages: notifications.unread > 0,
    hasUnreadChat: !!conversation,
    preferenceVersion,
    notifications
  }
}

const readWriteSummary = async (uid: number) => {
  const summary = await getUnreadStatus(uid)
  return {
    hasUnreadNotification: summary.hasUnreadMessages,
    hasUnreadConversation: summary.hasUnreadChat,
    preferenceVersion: summary.preferenceVersion,
    notifications: summary.notifications
  }
}

const filters = (
  uid: number,
  type?: string,
  category?: NotificationCategory,
  state = 'all'
) => Prisma.sql`
  recipient_id = ${uid}
  ${type ? Prisma.sql`AND type = ${type}` : Prisma.empty}
  ${category ? Prisma.sql`AND (${notificationCategorySql}) = ${category}` : Prisma.empty}
  ${state === 'all' ? Prisma.empty : Prisma.sql`AND status = ${state === 'unread' ? 0 : 1}`}
`

export const readMessage = async (
  uid: number,
  input?: z.infer<typeof readNotificationSchema>
) => {
  const parsed = readNotificationSchema.safeParse(input)
  if (!parsed.success)
    return {
      code: 'NOTIFICATION_SCOPE_REQUIRED' as const,
      message: '请刷新通知页面，仅确认已经看到的通知'
    }
  const results = await prisma.$transaction(async (transaction) => {
    if (!(await lockNotificationAccounts(transaction, [uid])).has(uid))
      throw new NotificationServiceError(
        401,
        'NOTIFICATION_ACCOUNT_GONE',
        '账号已不存在，请重新登录'
      )
    const ids = parsed.data.items
      .map((item) => item.id)
      .sort((first, second) => first - second)
    await transaction.$queryRaw`SELECT id FROM user_message WHERE recipient_id = ${uid} AND id = ANY(${ids}::int[]) ORDER BY id FOR UPDATE`
    const messages = await transaction.user_message.findMany({
      where: { recipient_id: uid, id: { in: ids } }
    })
    const results: {
      id: number
      outcome: 'read' | 'already_read' | 'changed' | 'missing'
    }[] = []
    for (const item of parsed.data.items) {
      const message = messages.find((message) => message.id === item.id)
      if (
        !message ||
        (parsed.data.target !== undefined &&
          message.link !== parsed.data.target)
      ) {
        results.push({ id: item.id, outcome: 'missing' })
      } else if (message.content_version.toString() !== item.version) {
        results.push({ id: item.id, outcome: 'changed' })
      } else if (message.status !== 0) {
        results.push({ id: item.id, outcome: 'already_read' })
      } else {
        const updated = await transaction.user_message.updateMany({
          where: {
            id: item.id,
            recipient_id: uid,
            status: 0,
            content_version: BigInt(item.version)
          },
          data: { status: 1, updated: message.updated }
        })
        results.push({
          id: item.id,
          outcome: updated.count === 1 ? 'read' : 'changed'
        })
      }
    }
    return results
  })
  return { results, summary: await readWriteSummary(uid) }
}

export const clearReadMessage = async (
  uid: number,
  type: string,
  category?: NotificationCategory
) => {
  const deleted = await prisma.$transaction(async (transaction) => {
    if (!(await lockNotificationAccounts(transaction, [uid])).has(uid))
      throw new NotificationServiceError(
        401,
        'NOTIFICATION_ACCOUNT_GONE',
        '账号已不存在，请重新登录'
      )
    const candidates = await transaction.$queryRaw<{ id: number }[]>(
      Prisma.sql`SELECT id FROM user_message WHERE ${filters(uid, type, category, 'read')} ORDER BY id FOR UPDATE`
    )
    if (!candidates.length) return 0
    return transaction.$executeRaw(
      Prisma.sql`DELETE FROM user_message WHERE ${filters(uid, type, category, 'read')} AND id = ANY(${candidates.map((message) => message.id)}::int[])`
    )
  })
  return { deleted, summary: await readWriteSummary(uid) }
}

export const getMessage = async (
  input: z.infer<typeof getMessageSchema>,
  uid: number
): Promise<NotificationList> =>
  prisma.$transaction(
    async (transaction) => {
      const account = await transaction.user.findUnique({
        where: { id: uid },
        select: { id: true }
      })
      if (!account)
        throw new NotificationServiceError(
          401,
          'NOTIFICATION_ACCOUNT_GONE',
          '账号已不存在，请重新登录'
        )
      const where = filters(uid, input.type, input.category, input.state)
      const summary = await readNotificationSummary(transaction, uid)
      const maxRows = await transaction.$queryRaw<{ maximum: number }[]>(
        Prisma.sql`SELECT COALESCE(max(id), 0) AS maximum FROM user_message WHERE ${where}`
      )
      const upperId =
        input.state === 'unread'
          ? (input.upperId ?? maxRows[0].maximum)
          : maxRows[0].maximum
      const boundedWhere = Prisma.sql`${where} ${input.state === 'unread' ? Prisma.sql`AND id <= ${upperId}` : Prisma.empty}`
      const rows = await transaction.$queryRaw<{ id: number }[]>(Prisma.sql`
      SELECT id FROM user_message WHERE ${boundedWhere}
      ${input.state === 'unread' && input.cursor ? Prisma.sql`AND id < ${input.cursor}` : Prisma.empty}
      ORDER BY id DESC LIMIT ${input.limit + 1}
      OFFSET ${input.state === 'unread' ? 0 : (input.page - 1) * input.limit}
    `)
      const ids = rows.slice(0, input.limit).map((row) => row.id)
      const data = ids.length
        ? await transaction.user_message.findMany({
            where: { recipient_id: uid, id: { in: ids } },
            include: {
              sender: { select: { id: true, name: true, avatar: true } }
            },
            orderBy: { id: 'desc' }
          })
        : []
      const total = await transaction.$queryRaw<{ amount: number }[]>(
        Prisma.sql`SELECT count(*)::int AS amount FROM user_message WHERE ${boundedWhere}`
      )
      const messages: Message[] = data.map((message) => ({
        id: message.id,
        type: message.type,
        content: message.content,
        status: message.status,
        link: message.link,
        created: message.created,
        updated: message.event_type ? message.updated : undefined,
        sender: message.sender,
        eventType: message.event_type as Message['eventType'],
        category: notificationCategory(message.event_type, message.type),
        contentVersion: message.content_version.toString()
      }))
      return {
        messages,
        total: total[0].amount,
        upperId,
        nextCursor: rows.length > input.limit ? (ids.at(-1) ?? null) : null,
        contentSequence: input.category
          ? summary.categories[input.category].sequence
          : summary.sequence
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
  )

export const create = async (
  input: z.infer<typeof createMessageSchema>,
  uid: number
) => {
  const message = await createMessage({
    type: 'system',
    event_type: 'site-announcement',
    content: input.content,
    sender_id: uid,
    recipient_id: input.recipientId,
    link: input.link
  })
  return message ? { id: message.id } : { skipped: true }
}
