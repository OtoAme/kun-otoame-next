import { Prisma } from '@prisma/client'
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_EVENTS
} from '~/constants/notification'
import type { NotificationSummary } from '~/types/api/message'

export const notificationCategorySql = Prisma.sql`CASE
  ${Prisma.join(
    Object.entries(NOTIFICATION_EVENTS).map(
      ([name, definition]) =>
        Prisma.sql`WHEN event_type = ${name} THEN ${definition.category}`
    ),
    ' '
  )}
  WHEN type IN ('mention', 'comment') THEN 'mention'
  WHEN type IN ('like', 'favorite', 'follow') THEN 'interaction'
  WHEN type IN ('apply', 'pr') THEN 'review'
  WHEN type IN ('feedback', 'report') THEN 'maintenance'
  ELSE 'account' END`

export const readNotificationSummary = async (
  database: Prisma.TransactionClient,
  uid: number
): Promise<NotificationSummary> => {
  const rows = await database.$queryRaw<
    {
      unread: number
      counts: Record<string, number>
      sequences: Record<string, string>
    }[]
  >(Prisma.sql`
    SELECT (SELECT count(*)::int FROM user_message WHERE recipient_id = ${uid} AND status = 0) AS unread,
      COALESCE((SELECT jsonb_object_agg(category, amount) FROM (
        SELECT ${notificationCategorySql} AS category, count(*)::int AS amount
        FROM user_message WHERE recipient_id = ${uid} AND status = 0 GROUP BY 1
      ) counts), '{}'::jsonb) AS counts,
      COALESCE((SELECT jsonb_object_agg(category, sequence::text)
        FROM notification_content_sequence WHERE user_id = ${uid}), '{}'::jsonb) AS sequences
  `)
  const row = rows[0]
  if (!row) throw new Error('Notification summary unavailable')
  return {
    unread: row.unread,
    sequence: row.sequences[''] ?? '0',
    categories: Object.fromEntries(
      NOTIFICATION_CATEGORIES.map((category) => [
        category,
        {
          unread: row.counts[category] ?? 0,
          sequence: row.sequences[category] ?? '0'
        }
      ])
    ) as NotificationSummary['categories']
  }
}
