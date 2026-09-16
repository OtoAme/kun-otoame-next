import { z } from 'zod'
import {
  CASE_ADMIN_ACTIONS,
  CASE_CONTENT_ACTIONS,
  CASE_KINDS,
  CASE_MESSAGE_MIN_LENGTH,
  CASE_RESOLUTIONS,
  CASE_RESOURCE_ACTIONS,
  CASE_STATUSES,
  CASE_TABS,
  CASE_TARGET_TYPES,
  CASE_CONTENT_MAX_LENGTH,
  CASE_DESCRIPTION_MIN_LENGTH,
  CASE_REPORT_MIN_LENGTH
} from '~/constants/case'

const idSchema = z.coerce
  .number({ message: 'ID 必须为数字' })
  .int({ message: 'ID 必须为整数' })
  .min(1, { message: 'ID 必须为正整数' })
  .max(2147483647)

const caseIdSchema = idSchema
const contentSchema = z
  .string({ message: '内容必须是文本' })
  .trim()
  .max(CASE_CONTENT_MAX_LENGTH, {
    message: `内容最多 ${CASE_CONTENT_MAX_LENGTH} 个字符`
  })

export const caseKindSchema = z.enum(CASE_KINDS)
export const caseTargetTypeSchema = z.enum(CASE_TARGET_TYPES)
export const caseStatusSchema = z.enum(CASE_STATUSES)
export const caseTabSchema = z.enum(CASE_TABS)
export const caseResolutionSchema = z.enum(CASE_RESOLUTIONS)

/**
 * Unknown fields are stripped by Zod. Ownership, source, public visibility and
 * patch_id therefore cannot be supplied by a caller even if an old client
 * sends fields with those names.
 */
export const createCaseSchema = z
  .object({
    kind: caseKindSchema,
    targetType: caseTargetTypeSchema,
    targetId: idSchema,
    expectedPatchId: idSchema.optional(),
    content: contentSchema
  })
  .superRefine((input, ctx) => {
    const minimum =
      input.kind === 'content_violation'
        ? CASE_REPORT_MIN_LENGTH
        : CASE_DESCRIPTION_MIN_LENGTH
    if (input.content.length < minimum) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_small,
        minimum,
        inclusive: true,
        type: 'string',
        path: ['content'],
        message:
          input.kind === 'content_violation'
            ? `举报原因最少 ${minimum} 个字符`
            : `问题描述最少 ${minimum} 个字符`
      })
    }
  })

/**
 * Comma-separated status filter. The list has to arrive as one value because
 * `kunParseGetQuery` folds the query string through `Object.fromEntries`, which
 * keeps only the last occurrence of a repeated key. Blank input normalizes to
 * `undefined`, duplicates collapse, and an unknown segment is rejected rather
 * than dropped: silently ignoring it would render a filter the caller believes
 * is active.
 */
export const caseStatusesSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => {
    if (!value) return undefined
    const parts = [
      ...new Set(
        value
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
      )
    ]
    return parts.length ? parts : undefined
  })
  .pipe(
    z
      .array(z.enum(CASE_STATUSES, { message: '状态筛选包含未知状态' }))
      .optional()
  )

export const caseListSchema = z.object({
  tab: caseTabSchema.default('reported'),
  status: caseStatusSchema.optional(),
  statuses: caseStatusesSchema,
  page: z.coerce.number().int().min(1).max(2147483647).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
})

export const caseIdParamSchema = z.object({ id: caseIdSchema })

export const appendCaseMessageSchema = z.object({
  caseId: caseIdSchema,
  content: z
    .string({ message: '回复内容必须是文本' })
    .trim()
    .min(CASE_MESSAGE_MIN_LENGTH, { message: '回复内容不能为空' })
    .max(CASE_CONTENT_MAX_LENGTH, {
      message: `回复内容最多 ${CASE_CONTENT_MAX_LENGTH} 个字符`
    })
})
export const appendCaseMessageBodySchema = appendCaseMessageSchema.omit({
  caseId: true
})

export const resolveCaseSchema = z.object({
  caseId: caseIdSchema,
  resolution: caseResolutionSchema,
  content: contentSchema.optional().default('')
})
export const resolveCaseBodySchema = resolveCaseSchema.omit({ caseId: true })

export const reopenCaseSchema = z.object({ caseId: caseIdSchema })

export const adminCaseListSchema = z.object({
  status: caseStatusSchema.optional(),
  statuses: caseStatusesSchema,
  /**
   * Explicit "no status predicate at all", so the unfiltered queue view does
   * not have to be spelled as a client-side enumeration of every status — an
   * enumeration would silently stop covering a status the product starts
   * writing later. A query value is a string, hence the literal 'true'/'false'
   * the repo already uses elsewhere: `z.coerce.boolean()` would read 'false'
   * as true.
   */
  allStatuses: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  kind: caseKindSchema.optional(),
  page: z.coerce.number().int().min(1).max(2147483647).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(300).default('')
})

export const adminCaseHandleSchema = z.object({
  caseId: caseIdSchema,
  action: z.enum(CASE_ADMIN_ACTIONS),
  resolution: caseResolutionSchema.optional(),
  content: contentSchema.optional().default(''),
  handledUserConfirmed: z.boolean().optional()
})
export const adminCaseHandleBodySchema = adminCaseHandleSchema.omit({
  caseId: true
})

export const adminCaseResourceSchema = z.object({
  caseId: caseIdSchema,
  action: z.enum(CASE_RESOURCE_ACTIONS),
  targetPatchId: idSchema.optional(),
  content: contentSchema.optional().default('')
})
export const adminCaseResourceBodySchema = adminCaseResourceSchema.omit({
  caseId: true
})

export const adminCaseContentSchema = z.object({
  caseId: caseIdSchema,
  action: z.enum(CASE_CONTENT_ACTIONS),
  content: contentSchema.optional().default('')
})
export const adminCaseContentBodySchema = adminCaseContentSchema.omit({
  caseId: true
})

export const internalCaseOpenSchema = z.object({
  kind: caseKindSchema,
  targetType: caseTargetTypeSchema,
  targetId: idSchema,
  reporterId: idSchema.nullable().optional(),
  content: contentSchema.default(''),
  source: z
    .enum(['user', 'system', 'publisher_convert', 'help_escalation'])
    .default('system')
})
