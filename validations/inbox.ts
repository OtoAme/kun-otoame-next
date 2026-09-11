import { z } from 'zod'
import { INBOX_KINDS } from '~/types/api/inbox'

export const adminInboxKindSchema = z.enum(INBOX_KINDS)

export const adminInboxIdSchema = z
  .string()
  .regex(/^[1-9]\d*$/, { message: '事项 ID 格式不正确' })
  .transform(Number)
  .pipe(z.number().int().positive().max(2147483647))

export const adminInboxQuerySchema = z.object({
  kinds: z
    .string()
    .transform((value) => [...new Set(value.split(','))])
    .pipe(z.array(adminInboxKindSchema).min(1))
    .default(INBOX_KINDS.join(',')),
  search: z
    .string()
    .trim()
    .max(300, {
      message: '搜索关键词不能超过 300 个字符'
    })
    .default(''),
  order: z.enum(['waiting', 'kind']).default('waiting'),
  limitPerKind: z.coerce.number().int().min(1).max(50).default(50)
})

export const adminInboxItemSchema = z.object({
  kind: adminInboxKindSchema,
  id: adminInboxIdSchema
})
