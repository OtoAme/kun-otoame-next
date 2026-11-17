import { z } from 'zod'

export const preferenceKeySchema = z.union([
  z.literal('nsfw'),
  z.literal('email-notice'),
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
