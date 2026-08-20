import { z } from 'zod'
import {
  getMoemoepointRangeDays,
  isValidMoemoepointDate,
  MAX_MOEMOEPOINT_CUSTOM_RANGE_DAYS
} from '~/utils/moemoepointDateRange'

const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: '日期格式必须为 YYYY-MM-DD' })
  .refine(isValidMoemoepointDate, { message: '日期不合法' })

export const moemoepointLedgerQuerySchema = z
  .object({
    range: z.enum(['7d', '30d', 'custom']).default('30d'),
    start: calendarDateSchema.optional(),
    end: calendarDateSchema.optional(),
    page: z.coerce.number().int().min(1).max(9999999).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(30)
  })
  .superRefine((input, context) => {
    if (input.range !== 'custom') {
      return
    }
    if (!input.start || !input.end) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: '自定义日期需要同时选择开始和结束日期'
      })
      return
    }

    const days = getMoemoepointRangeDays(input.start, input.end)
    if (days === null || days < 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: '结束日期不能早于开始日期'
      })
      return
    }
    if (days > MAX_MOEMOEPOINT_CUSTOM_RANGE_DAYS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `自定义日期范围最多为 ${MAX_MOEMOEPOINT_CUSTOM_RANGE_DAYS} 天`
      })
    }
  })

export const moemoepointUserIdSchema = z.object({
  id: z.coerce.number().int().min(1).max(9999999)
})
