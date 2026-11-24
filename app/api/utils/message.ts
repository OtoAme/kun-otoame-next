import { createHash } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '~/prisma/index'
import {
  NOTIFICATION_EVENTS,
  isNotificationEvent,
  type NotificationCategory,
  type NotificationEvent
} from '~/constants/notification'
import type { CreateMessageType } from '~/types/api/message'

type MessageClient = PrismaClient | Prisma.TransactionClient
type Transaction = Prisma.TransactionClient
export type NotificationOutcome =
  | 'created'
  | 'duplicate'
  | 'disabled'
  | 'excluded'

export const notificationTransaction = <Result>(
  database: MessageClient,
  action: (transaction: Transaction) => Promise<Result>
): Promise<Result> =>
  '$transaction' in database
    ? database.$transaction(action, { timeout: 10000 })
    : action(database)

export const lockNotificationAccounts = async (
  transaction: Transaction,
  ids: number[]
) => {
  const ordered = [...new Set(ids)].sort((first, second) => first - second)
  if (!ordered.length) return new Set<number>()
  const users = await transaction.$queryRaw<{ id: number }[]>`
    SELECT id FROM public."user" WHERE id = ANY(${ordered}::int[]) ORDER BY id FOR KEY SHARE
  `
  return new Set(users.map((user) => user.id))
}

const resolveEvent = (data: CreateMessageType): NotificationEvent => {
  if (data.event_type && isNotificationEvent(data.event_type))
    return data.event_type
  const legacy = {
    like: 'like',
    favorite: 'favorite',
    comment: 'comment-reply',
    follow: 'follow',
    mention: 'mention'
  } as const
  if (Object.hasOwn(legacy, data.type))
    return legacy[data.type as keyof typeof legacy]
  throw new Error('Notification requires an explicit registered event')
}

export const selectNotificationRecipients = async (
  transaction: Transaction,
  inputs: CreateMessageType[]
) => {
  const events = inputs.map(resolveEvent)
  const userIds = inputs
    .flatMap((input) => [input.recipient_id, input.sender_id, input.actor_id])
    .filter((id): id is number => id !== undefined)
  const existing = await lockNotificationAccounts(transaction, userIds)
  const optional = inputs.filter(
    (input) =>
      input.recipient_id && NOTIFICATION_EVENTS[resolveEvent(input)].optional
  )
  const preferences = optional.length
    ? await transaction.notification_subscription.findMany({
        where: {
          user_id: {
            in: [...new Set(optional.map((input) => input.recipient_id!))]
          },
          event_type: { in: [...new Set(optional.map(resolveEvent))] }
        }
      })
    : []
  const disabled = new Set(
    preferences
      .filter((preference) => !preference.enabled)
      .map((preference) => `${preference.user_id}:${preference.event_type}`)
  )
  return inputs.map((input, index) => {
    const eventType = events[index]
    const { actor_id, ...message } = input
    const applicationRecord =
      input.recipient_id === undefined &&
      eventType === 'creator-application' &&
      input.type === 'apply' &&
      input.sender_id !== undefined &&
      existing.has(input.sender_id)
    const excluded =
      input.recipient_id === undefined
        ? !applicationRecord
        : !existing.has(input.recipient_id) ||
          input.recipient_id === (actor_id ?? input.sender_id)
    return {
      input: {
        ...message,
        event_type: eventType,
        ...(input.sender_id && !existing.has(input.sender_id)
          ? { sender_id: undefined }
          : {})
      },
      outcome: excluded
        ? ('excluded' as const)
        : input.recipient_id &&
            NOTIFICATION_EVENTS[eventType].optional &&
            disabled.has(`${input.recipient_id}:${eventType}`)
          ? ('disabled' as const)
          : null
    }
  })
}

export const advanceNotificationSequences = async (
  transaction: Transaction,
  changes: {
    recipient_id: number | null
    event_type: string | null
    type: string
  }[]
) => {
  const counters = new Map<
    string,
    { uid: number; category: string; amount: number }
  >()
  for (const change of changes) {
    if (change.recipient_id === null) continue
    if (!change.event_type || !isNotificationEvent(change.event_type))
      throw new Error('Unregistered notification content change')
    const category: NotificationCategory =
      NOTIFICATION_EVENTS[change.event_type].category
    for (const scope of ['', category]) {
      const key = `${change.recipient_id}:${scope}`
      const previous = counters.get(key)
      counters.set(key, {
        uid: change.recipient_id,
        category: scope,
        amount: (previous?.amount ?? 0) + 1
      })
    }
  }
  const ordered = [...counters.values()].sort(
    (first, second) =>
      first.uid - second.uid || first.category.localeCompare(second.category)
  )
  if (!ordered.length) return
  await transaction.$executeRaw(Prisma.sql`
    INSERT INTO notification_content_sequence (user_id, category, sequence)
    VALUES ${Prisma.join(ordered.map((counter) => Prisma.sql`(${counter.uid}, ${counter.category}, ${BigInt(counter.amount)})`))}
    ON CONFLICT (user_id, category) DO UPDATE
      SET sequence = notification_content_sequence.sequence + EXCLUDED.sequence
  `)
}

export const createNotificationBatch = async (
  inputs: CreateMessageType[],
  database: MessageClient = prisma,
  deduplicate = false
) =>
  notificationTransaction(database, async (transaction) => {
    const selected = await selectNotificationRecipients(transaction, inputs)
    const allowed = selected
      .filter((item) => !item.outcome)
      .sort(
        (first, second) =>
          (first.input.recipient_id ?? 0) - (second.input.recipient_id ?? 0)
      )
    const data = allowed.map(({ input }) => ({
      ...input,
      ...(deduplicate
        ? {
            dedup_key: createHash('sha256')
              .update(
                JSON.stringify([
                  input.event_type,
                  input.type,
                  input.sender_id ?? null,
                  input.recipient_id ?? null,
                  input.content,
                  input.link
                ])
              )
              .digest('hex')
          }
        : {})
    }))
    const created = data.length
      ? await transaction.user_message.createManyAndReturn({
          data,
          skipDuplicates: true
        })
      : []
    await advanceNotificationSequences(transaction, created)
    const remaining = [...created]
    return selected.map((item) => {
      const index = item.outcome
        ? -1
        : remaining.findIndex(
            (message) =>
              message.recipient_id === (item.input.recipient_id ?? null) &&
              message.sender_id === (item.input.sender_id ?? null) &&
              message.type === item.input.type &&
              message.link === item.input.link &&
              message.content === item.input.content &&
              message.event_type === item.input.event_type
          )
      const message = index < 0 ? null : remaining.splice(index, 1)[0]
      return {
        outcome:
          item.outcome ??
          ((message ? 'created' : 'duplicate') as NotificationOutcome),
        message
      }
    })
  })

export const createMessage = async (
  data: CreateMessageType,
  database: MessageClient = prisma
) => (await createNotificationBatch([data], database))[0].message

export const createDedupMessage = async (
  data: CreateMessageType,
  database: MessageClient = prisma
) => (await createNotificationBatch([data], database, true))[0].message

export const aggregateNotificationBatch = async (
  inputs: CreateMessageType[],
  content: (input: CreateMessageType, count: number) => string,
  transaction: Transaction
) => {
  const recipients = await selectNotificationRecipients(transaction, inputs)
  const changes: {
    recipient_id: number | null
    event_type: string | null
    type: string
  }[] = []
  for (const selected of recipients.sort(
    (first, second) =>
      (first.input.recipient_id ?? 0) - (second.input.recipient_id ?? 0)
  )) {
    if (selected.outcome) continue
    const input = selected.input
    let completed = false
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = await transaction.user_message.findFirst({
        where: {
          recipient_id: input.recipient_id,
          event_type: input.event_type,
          link: input.link,
          status: 0
        },
        orderBy: { id: 'desc' }
      })
      if (!candidate) {
        const message = await transaction.user_message.create({
          data: { ...input, content: content(input, 1) }
        })
        changes.push(message)
        completed = true
        break
      }
      const updated = await transaction.user_message.updateMany({
        where: {
          id: candidate.id,
          recipient_id: input.recipient_id,
          event_type: input.event_type,
          link: input.link,
          status: 0,
          content_version: candidate.content_version
        },
        data: {
          content: content(input, candidate.aggregate_count + 1),
          aggregate_count: { increment: 1 },
          content_version: { increment: 1 }
        }
      })
      if (updated.count === 1) {
        changes.push(candidate)
        completed = true
        break
      }
    }
    if (!completed)
      throw new Error(
        'Notification aggregation changed concurrently; retry the business operation'
      )
  }
  await advanceNotificationSequences(transaction, changes)
}
