import { z } from 'zod'

export const createConversationSchema = z.object({
  targetUserId: z.coerce.number().min(1).max(9999999)
})

export const getConversationsSchema = z.object({
  page: z.coerce.number().min(1).max(9999999),
  limit: z.coerce.number().min(1).max(30)
})

const messageTypeSchema = z.union([z.literal(0), z.literal(1)]).default(0)

const privateMessageImageSchema = z.object({
  url: z.string().url().max(1000),
  width: z.coerce.number().int().min(1).max(20000),
  height: z.coerce.number().int().min(1).max(20000),
  size: z.coerce
    .number()
    .int()
    .min(1)
    .max(8 * 1024 * 1024),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/avif']),
  name: z.string().trim().min(1).max(255)
})

export const getConversationMessagesSchema = z
  .object({
    page: z.coerce.number().min(1).max(9999999),
    limit: z.coerce.number().min(1).max(50),
    beforeId: z.coerce.number().min(1).max(9999999).optional(),
    afterId: z.coerce.number().min(1).max(9999999).optional()
  })
  .refine((input) => !(input.beforeId && input.afterId), {
    message: 'beforeId 和 afterId 不能同时使用'
  })

export const sendPrivateMessageSchema = z
  .object({
    type: messageTypeSchema,
    content: z
      .string()
      .trim()
      .max(2000, { message: '消息内容最多 2000 个字符' })
      .optional(),
    image: privateMessageImageSchema.optional(),
    images: z.array(privateMessageImageSchema).min(1).max(9).optional(),
    replyToMessageId: z.coerce.number().min(1).max(9999999).optional(),
    replySelectedText: z.string().trim().max(500).optional(),
    replyImageIndex: z.coerce.number().int().min(0).max(8).optional()
  })
  .superRefine((input, ctx) => {
    const content = input.content?.trim() ?? ''
    const imageCount = input.images?.length ?? (input.image ? 1 : 0)

    if (input.type === 0 && !content) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '消息内容不能为空',
        path: ['content']
      })
    }

    if (input.type === 1 && imageCount === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '请先选择图片',
        path: ['images']
      })
    }

    if (imageCount > 0 && input.type !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '图片消息类型不正确',
        path: ['type']
      })
    }
  })

export const updatePrivateMessageSchema = z.object({
  messageId: z.coerce.number().min(1).max(9999999),
  content: z
    .string()
    .trim()
    .min(1, { message: '消息内容不能为空' })
    .max(2000, { message: '消息内容最多 2000 个字符' })
})

export const deletePrivateMessageSchema = z.object({
  messageId: z.coerce.number().min(1).max(9999999)
})
