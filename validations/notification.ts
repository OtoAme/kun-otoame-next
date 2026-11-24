import { z } from 'zod'
import {
  NOTIFICATION_CATEGORIES,
  isNotificationSequence,
  isNotificationVersion
} from '~/constants/notification'

const sequence = z.string().refine(isNotificationSequence)
const counter = z
  .object({ unread: z.number().int().nonnegative().max(2147483647), sequence })
  .strict()

export const readAllNotificationsSchema = z
  .object({ scope: z.enum(['all', ...NOTIFICATION_CATEGORIES]) })
  .strict()

export const notificationSummarySchema = z
  .object({
    unread: z.number().int().nonnegative().max(2147483647),
    sequence,
    categories: z
      .object({
        interaction: counter,
        help: counter,
        review: counter,
        maintenance: counter,
        account: counter
      })
      .strict()
  })
  .strict()
  .refine(
    (value) =>
      NOTIFICATION_CATEGORIES.reduce(
        (sum, category) => sum + value.categories[category].unread,
        0
      ) === value.unread
  )

export const readNotificationSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.number().int().positive().max(2147483647),
            version: z.string().refine(isNotificationVersion)
          })
          .strict()
      )
      .min(1)
      .max(30),
    target: z.string().max(1007).optional()
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.items.map((item) => item.id)).size === value.items.length
  )
