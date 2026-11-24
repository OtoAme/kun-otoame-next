import { z } from 'zod'
import { MESSAGE_NOTIFICATION_TYPE, MESSAGE_TYPE } from '~/constants/message'
import { NOTIFICATION_CATEGORIES } from '~/constants/notification'

export const createMessageSchema = z.object({
  type: z.enum(MESSAGE_NOTIFICATION_TYPE),
  content: z
    .string()
    .url('请输入有效的链接格式')
    .max(1007, { message: '单个链接的长度最大 1007 个字符' }),
  recipientId: z.coerce.number().int().min(1).max(9999999),
  link: z.string().max(1007)
})

export const getMessageSchema = z.object({
  type: z.enum(MESSAGE_TYPE).optional(),
  category: z.enum(NOTIFICATION_CATEGORIES).optional(),
  state: z.enum(['unread', 'all', 'read']).default('all'),
  cursor: z.coerce.number().int().positive().max(2147483647).optional(),
  upperId: z.coerce.number().int().nonnegative().max(2147483647).optional(),
  page: z.coerce.number().int().min(1).max(9999999),
  limit: z.coerce.number().int().min(1).max(30)
})

export const clearReadMessageSchema = z.object({
  category: z.enum(NOTIFICATION_CATEGORIES).optional(),
  type: z.enum(MESSAGE_TYPE).default('')
})
