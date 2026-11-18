import { z } from 'zod'
import {
  NOTIFICATION_SUBSCRIPTIONS,
  isNotificationSubscription
} from '~/constants/notification'

export const preferenceKeySchema = z.union([
  z.literal('nsfw'),
  z.literal('email-notice'),
  z.string().refine(isNotificationSubscription),
  z.string().regex(/^blocked-tag:[1-9]\d{0,8}$/)
])
export const preferenceSaveSchema = z
  .object({
    uid: z.number().int().positive(),
    context: z.string().regex(/^[a-f0-9]{64}$/),
    changes: z
      .array(
        z
          .object({
            key: preferenceKeySchema,
            value: z.union([z.boolean(), z.enum(['sfw', 'nsfw', 'all'])]),
            version: z.number().int().min(0).max(2147483646)
          })
          .strict()
      )
      .min(1)
      .max(100)
  })
  .strict()
  .superRefine((input, ctx) => {
    const keys = new Set<string>()
    input.changes.forEach((change, index) => {
      if (
        keys.has(change.key) ||
        (change.key === 'nsfw'
          ? typeof change.value !== 'string'
          : typeof change.value !== 'boolean')
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['changes', index],
          message: '设置项目重复或目标值非法'
        })
      }
      keys.add(change.key)
    })
  })

const preferenceItemSchema = z
  .object({
    value: z.union([z.boolean(), z.enum(['sfw', 'nsfw', 'all'])]),
    version: z.number().int().min(0).max(2147483647)
  })
  .strict()

export const preferenceSnapshotSchema = z
  .object({
    uid: z.number().int().positive(),
    context: z.string().regex(/^[a-f0-9]{64}$/),
    version: z.number().int().min(0).max(2147483647),
    nsfwSelected: z.boolean(),
    blockedTagIds: z.array(z.number().int().positive().max(2147483647)),
    items: z.record(z.string(), preferenceItemSchema)
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    const blocked = new Set(snapshot.blockedTagIds)
    const nsfw = snapshot.items.nsfw
    const email = snapshot.items['email-notice']
    if (
      !nsfw ||
      typeof nsfw.value !== 'string' ||
      !email ||
      typeof email.value !== 'boolean' ||
      NOTIFICATION_SUBSCRIPTIONS.some(
        (key) => typeof snapshot.items[key]?.value !== 'boolean'
      ) ||
      blocked.size !== snapshot.blockedTagIds.length ||
      (!snapshot.nsfwSelected && (nsfw.value !== 'sfw' || nsfw.version !== 0))
    ) {
      ctx.addIssue({ code: 'custom', message: '偏好快照不完整' })
    }
    for (const [key, item] of Object.entries(snapshot.items)) {
      if (
        !preferenceKeySchema.safeParse(key).success ||
        item.version > snapshot.version ||
        (key === 'nsfw'
          ? typeof item.value !== 'string'
          : typeof item.value !== 'boolean') ||
        (key.startsWith('blocked-tag:') &&
          item.value !== blocked.has(Number(key.slice(12))))
      ) {
        ctx.addIssue({ code: 'custom', message: '偏好快照项目非法' })
      }
    }
    for (const id of blocked) {
      if (snapshot.items[`blocked-tag:${id}`]?.value !== true)
        ctx.addIssue({ code: 'custom', message: '屏蔽标签快照不完整' })
    }
  })

export const preferenceConflictSchema = z
  .object({
    code: z.literal('PREFERENCE_CONFLICT'),
    message: z.string(),
    conflicts: z.array(preferenceKeySchema).min(1).max(100),
    snapshot: preferenceSnapshotSchema
  })
  .strict()
  .superRefine((conflict, ctx) => {
    if (conflict.conflicts.some((key) => !conflict.snapshot.items[key]))
      ctx.addIssue({ code: 'custom', message: '冲突快照缺少设置项' })
  })
