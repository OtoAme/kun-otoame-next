import { z } from 'zod'
import {
  SHOUTBOX_LEVELS,
  SHOUTBOX_PAGE_SIZE,
  SHOUTBOX_MAX_PAGES
} from '~/constants/shoutbox'

const shoutboxIdSchema = z.coerce.number().int().min(1).max(2147483647)
const requestIdSchema = z.string().uuid({ message: '请求 ID 必须为 UUID' })
const contentSchema = z
  .string()
  .trim()
  .min(1, { message: '小喇叭正文不能为空' })
  .max(200, { message: '小喇叭正文不能超过 200 个字符' })

// The MDX reader exposes long documents under /doc/[...slug]. Keep official
// details on that relative route so a client cannot turn the announcement
// link into an arbitrary external redirect.
export const shoutboxOfficialLinkSchema = z
  .string()
  .trim()
  .max(1000)
  .refine(
    (value) =>
      value === '' ||
      /^\/doc\/[A-Za-z0-9][A-Za-z0-9._~-]*(?:\/[A-Za-z0-9][A-Za-z0-9._~-]*)*$/.test(
        value
      ),
    { message: '官方详情链接必须是站内文档路径' }
  )

export const shoutboxCreateSchema = z.object({
  requestId: requestIdSchema,
  content: contentSchema,
  patchId: shoutboxIdSchema.optional()
})

export const shoutboxUpdateSchema = z.object({
  shoutboxId: shoutboxIdSchema,
  content: contentSchema
})

export const shoutboxDeleteSchema = z.object({
  shoutboxId: shoutboxIdSchema
})

export const shoutboxReportSchema = z.object({
  shoutboxId: shoutboxIdSchema,
  content: z
    .string({ message: '举报原因为必填字段' })
    .trim()
    .min(2, { message: '举报原因最少 2 个字符' })
    .max(5000, { message: '举报原因最多 5000 个字符' })
})

export const shoutboxListSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(2147483647).default(1),
    limit: z.coerce
      .number()
      .int()
      .refine((value) => value === SHOUTBOX_PAGE_SIZE, {
        message: `每页只能显示 ${SHOUTBOX_PAGE_SIZE} 条`
      })
      .default(SHOUTBOX_PAGE_SIZE),
    patch: z
      .string()
      .regex(/^[A-Za-z0-9]{8}$/, { message: 'OtomeGame ID 格式不正确' })
      .optional()
  })
  .superRefine((input, ctx) => {
    if (!input.patch && input.page > SHOUTBOX_MAX_PAGES) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        type: 'number',
        maximum: SHOUTBOX_MAX_PAGES,
        inclusive: true,
        path: ['page'],
        message: `小喇叭页最多为第 ${SHOUTBOX_MAX_PAGES} 页`
      })
    }
  })

export const shoutboxProfileSchema = z.object({
  uid: shoutboxIdSchema,
  page: z.coerce.number().int().min(1).max(2147483647).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(SHOUTBOX_PAGE_SIZE)
})

export const adminShoutboxListSchema = z.object({
  page: z.coerce.number().int().min(1).max(2147483647).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  tab: z
    .enum(['pending_review', 'public', 'removed', 'official'])
    .default('official')
})

export const adminShoutboxCreateSchema = z.object({
  requestId: requestIdSchema,
  content: contentSchema,
  level: z.enum(SHOUTBOX_LEVELS).default('normal'),
  effectiveFrom: z.coerce.date().optional(),
  effectiveTo: z.coerce.date().optional(),
  link: shoutboxOfficialLinkSchema.optional().default('')
})

export const adminShoutboxUpdateSchema = z
  .object({
    shoutboxId: shoutboxIdSchema,
    content: contentSchema.optional(),
    level: z.enum(SHOUTBOX_LEVELS).optional(),
    effectiveFrom: z.coerce.date().optional(),
    effectiveTo: z.coerce.date().optional(),
    link: shoutboxOfficialLinkSchema.optional(),
    action: z.enum(['end', 'cancel']).optional()
  })
  .superRefine((input, ctx) => {
    const hasFields =
      input.content !== undefined ||
      input.level !== undefined ||
      input.effectiveFrom !== undefined ||
      input.effectiveTo !== undefined ||
      input.link !== undefined
    if (input.action && hasFields) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['action'],
        message: '结束或撤回不能同时修改其他字段'
      })
    } else if (!input.action && !hasFields) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '请提供要更新的内容'
      })
    }
  })

export const adminShoutboxModerateSchema = z
  .object({
    shoutboxId: shoutboxIdSchema,
    action: z.enum(['hide', 'remove', 'restore', 'resolve']),
    resolution: z.enum(['accept', 'reject']).optional(),
    content: z
      .string()
      .trim()
      .max(5000, { message: '处理结果不能超过 5000 个字符' })
      .default('')
  })
  .superRefine((input, ctx) => {
    if (input.action === 'resolve' && input.resolution === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['resolution'],
        message: '结案必须提供受理或驳回结论'
      })
    }
  })
