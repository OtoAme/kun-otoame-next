import { z } from 'zod'
import { kunPasswordRegex } from '~/utils/validate'
import {
  SUPPORTED_LANGUAGE,
  SUPPORTED_PLATFORM,
  SUPPORTED_TYPE
} from '~/constants/resource'
import { isValidMoemoepointDate } from '~/utils/moemoepointDateRange'

export const adminReportTargetTypeSchema = z.enum([
  'comment',
  'rating',
  'shoutbox'
])

export const adminPaginationSchema = z.object({
  page: z.coerce.number().min(1).max(9999999),
  limit: z.coerce.number().min(1).max(100),
  search: z
    .string()
    .max(300, { message: '搜索关键词不能超过 300 个字符' })
    .optional()
})

// Comma-separated multi-value query parameter restricted to known values.
const csvEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((value) =>
      [...new Set(value.split(',').map((item) => item.trim()))].filter(Boolean)
    )
    .pipe(z.array(z.enum(values)).min(1).max(values.length))

const shanghaiDate = z
  .string()
  .refine(isValidMoemoepointDate, { message: '日期格式应为 YYYY-MM-DD' })

export const ADMIN_RESOURCE_SEARCH_FIELDS = [
  'all',
  'text',
  'game',
  'link',
  'id'
] as const
export const ADMIN_RESOURCE_SORTS = [
  'created_desc',
  'created_asc',
  'download_desc',
  'download_asc'
] as const

export const adminResourcePaginationSchema = adminPaginationSchema
  .extend({
    resourceId: z.coerce.number().int().positive().max(2147483647).optional(),
    limit: z.coerce.number().min(1).max(500),
    userId: z.coerce.number().min(1).max(9999999).optional(),
    /**
     * Without it the search keeps its original meaning (link or BLAKE3 hash),
     * so callers that predate the console filters behave as before.
     */
    searchField: z.enum(ADMIN_RESOURCE_SEARCH_FIELDS).optional(),
    section: z.enum(['galgame', 'patch']).optional(),
    status: csvEnum(['0', '1', '2'])
      .transform((values) => values.map(Number))
      .optional(),
    publisher: z.enum(['official', 'user']).optional(),
    type: csvEnum(SUPPORTED_TYPE as [string, ...string[]]).optional(),
    language: csvEnum(SUPPORTED_LANGUAGE as [string, ...string[]]).optional(),
    platform: csvEnum(SUPPORTED_PLATFORM as [string, ...string[]]).optional(),
    health: z.enum(['broken', 'attention', 'healthy']).optional(),
    from: shanghaiDate.optional(),
    to: shanghaiDate.optional(),
    /**
     * Content rating for the management list. When present it replaces the
     * viewer's own display setting, so the list is not narrowed by it.
     */
    rating: z.enum(['all', 'sfw', 'nsfw']).optional(),
    sort: z.enum(ADMIN_RESOURCE_SORTS).optional()
  })
  .refine((input) => !input.from || !input.to || input.from <= input.to, {
    message: '开始日期不能晚于结束日期',
    path: ['to']
  })

export const adminUserSearchTypeSchema = z.enum(['name', 'email', 'id'])

export const adminUserPaginationSchema = adminPaginationSchema.extend({
  limit: z.coerce.number().min(1).max(500),
  searchType: adminUserSearchTypeSchema.default('name')
})

export const adminGalgamePaginationSchema = adminPaginationSchema.extend({
  limit: z.coerce.number().min(1).max(500),
  /** Same meaning as on the resource list; replaces the display setting. */
  rating: z.enum(['all', 'sfw', 'nsfw']).optional()
})

export const adminCommentSearchTypeSchema = z.enum(['content', 'user'])
const adminCommentDeleteLimit = 30

export const adminCommentPaginationSchema = adminPaginationSchema.extend({
  limit: z.coerce.number().min(1).max(500),
  searchType: adminCommentSearchTypeSchema.default('content'),
  userId: z.coerce.number().min(1).max(9999999).optional()
})

const adminCommentIdsSchema = z
  .string()
  .trim()
  .min(1, { message: '至少选择一条评论' })
  .refine(
    (value) =>
      value.split(',').every((item) => {
        const trimmed = item.trim()
        if (!/^\d+$/.test(trimmed)) {
          return false
        }

        const commentId = Number.parseInt(trimmed, 10)
        return commentId >= 1 && commentId <= 9999999
      }),
    { message: '评论 ID 格式不正确' }
  )
  .transform((value) => [
    ...new Set(
      value
        .split(',')
        .map((item) => Number.parseInt(item.trim(), 10))
        .filter((commentId) => commentId >= 1 && commentId <= 9999999)
    )
  ])
  .refine((commentIds) => commentIds.length <= adminCommentDeleteLimit, {
    message: `单次最多删除 ${adminCommentDeleteLimit} 条评论`
  })

export const adminDeleteCommentSchema = z.union([
  z
    .object({
      commentId: z.coerce
        .number({ message: '评论 ID 必须为数字' })
        .min(1)
        .max(9999999)
    })
    .transform(({ commentId }) => ({
      commentIds: [commentId]
    })),
  z
    .object({
      commentIds: adminCommentIdsSchema
    })
    .transform(({ commentIds }) => ({
      commentIds
    }))
])

export const adminGetFullCommentSchema = z.object({
  commentId: z.coerce.number().min(1).max(9999999)
})

export const adminReportPaginationSchema = adminPaginationSchema.extend({
  tab: z.enum(['pending', 'handled']).default('pending'),
  targetType: adminReportTargetTypeSchema.default('comment')
})

export const adminUpdateUserSchema = z.object({
  uid: z.coerce.number().min(1).max(9999999),
  name: z
    .string()
    .trim()
    .min(1, { message: '用户名长度至少为 1 个字符' })
    .max(17, { message: '用户名长度不能超过 17 个字符' }),
  email: z.string().trim().email({ message: '请输入合法的邮箱格式' }),
  role: z.coerce.number().int().min(1).max(4),
  status: z.coerce.number().min(0).max(2),
  dailyImageCount: z.coerce.number().min(0).max(50),
  password: z.preprocess(
    (value) => {
      if (typeof value !== 'string') {
        return value
      }

      const trimmedValue = value.trim()
      return trimmedValue ? trimmedValue : undefined
    },
    z
      .string()
      .regex(kunPasswordRegex, {
        message:
          '新密码格式非法, 密码长度需为 6 到 1007 位, 且至少包含一个英文字符和一个数字'
      })
      .optional()
  ),
  bio: z.string().trim().max(107, { message: '个人简介不能超过 107 个字符' })
})

export const adminCreatorPaginationSchema = adminPaginationSchema.extend({
  /** Open applications (unread or read) by default; history views opt in. */
  status: z.enum(['pending', 'approved', 'declined', 'all']).default('pending')
})

export const approveCreatorSchema = z.object({
  messageId: z.coerce.number().min(1).max(9999999),
  uid: z.coerce.number().min(1).max(9999999)
})

export const declineCreatorSchema = z.object({
  messageId: z.coerce.number().min(1).max(9999999),
  reason: z
    .string()
    .trim()
    .min(1)
    .max(1007, { message: '拒绝原因不能超过 1007 个字符' })
})

export const adminSendEmailSchema = z.object({
  templateId: z.string(),
  variables: z.record(z.string(), z.string())
})

export const adminHandleFeedbackSchema = z.object({
  messageId: z.coerce.number().min(1).max(9999999),
  content: z
    .string()
    .trim()
    .max(5000, { message: '回复内容不能超过 5000 个字符' })
})

export const adminRatingSearchTypeSchema = z.enum(['content', 'user'])
const adminRatingDeleteLimit = 30

export const adminRatingPaginationSchema = adminPaginationSchema.extend({
  limit: z.coerce.number().min(1).max(500),
  searchType: adminRatingSearchTypeSchema.default('content'),
  userId: z.coerce.number().min(1).max(9999999).optional()
})

const adminRatingIdsSchema = z
  .string()
  .trim()
  .min(1, { message: '至少选择一条评价' })
  .refine(
    (value) =>
      value.split(',').every((item) => {
        const trimmed = item.trim()
        if (!/^\d+$/.test(trimmed)) {
          return false
        }

        const ratingId = Number.parseInt(trimmed, 10)
        return ratingId >= 1 && ratingId <= 9999999
      }),
    { message: '评价 ID 格式不正确' }
  )
  .transform((value) => [
    ...new Set(
      value
        .split(',')
        .map((item) => Number.parseInt(item.trim(), 10))
        .filter((ratingId) => ratingId >= 1 && ratingId <= 9999999)
    )
  ])
  .refine((ratingIds) => ratingIds.length <= adminRatingDeleteLimit, {
    message: `单次最多删除 ${adminRatingDeleteLimit} 条评价`
  })

export const adminDeleteRatingSchema = z.union([
  z
    .object({
      ratingId: z.coerce
        .number({ message: '评价 ID 必须为数字' })
        .min(1)
        .max(9999999)
    })
    .transform(({ ratingId }) => ({
      ratingIds: [ratingId]
    })),
  z
    .object({
      ratingIds: adminRatingIdsSchema
    })
    .transform(({ ratingIds }) => ({
      ratingIds
    }))
])

export const patchRatingUpdateSchema = z.object({
  ratingId: z.coerce.number().min(1).max(9999999),
  shortSummary: z
    .string()
    .trim()
    .min(1, { message: '评价内容不可为空' })
    .max(1314, { message: '评价内容不能超过 1314 个字符' })
})

export const adminHandleReportSchema = z.object({
  reportId: z.coerce.number().min(1).max(9999999),
  action: z.enum(['delete', 'reject']),
  content: z
    .string()
    .trim()
    .max(5000, { message: '处理结果不能超过 5000 个字符' })
})

export const adminGetFullRatingSchema = z.object({
  ratingId: z.coerce.number().min(1).max(9999999)
})

export const approvePatchResourceSchema = z.object({
  resourceId: z.coerce.number().min(1).max(9999999)
})

export const declinePatchResourceSchema = z.object({
  resourceId: z.coerce.number().min(1).max(9999999),
  reason: z
    .string()
    .trim()
    .min(1)
    .max(1007, { message: '拒绝原因不能超过 1007 个字符' })
})

export const adminUpdateRedirectSchema = z.object({
  enableRedirect: z.coerce.boolean(),
  excludedDomains: z.array(
    z.string().max(500, { message: '单个域名不能超过 500 个字符' })
  ),
  delaySeconds: z.coerce.number()
})

export const adminUpdateDisableRegisterSchema = z.object({
  disableRegister: z.boolean()
})

export const adminGrantMoemoepointSchema = z.object({
  uid: z.coerce.number().min(1).max(9999999),
  amount: z.coerce.number().int().min(1).max(100000),
  requestId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .max(500, { message: '理由不能超过 500 个字符' })
    .optional()
})

export const adminDisableUser2FASchema = z.object({
  uid: z.coerce.number({ message: '用户 ID 必须为数字' }).min(1).max(9999999)
})
