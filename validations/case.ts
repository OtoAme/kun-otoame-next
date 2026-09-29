import { z } from 'zod'
import {
  CASE_ADMIN_ACTIONS,
  CASE_CONTENT_ACTIONS,
  CASE_IMAGE_MAX_PER_MESSAGE,
  CASE_KINDS,
  CASE_MESSAGE_MIN_LENGTH,
  CASE_OWNER_TYPES,
  CASE_RESOLUTIONS,
  CASE_RESOURCE_ACTIONS,
  CASE_SEARCH_FIELDS,
  CASE_SITE_TARGET_ID,
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
 * Keys returned by `POST /api/case/image`. The server only accepts keys it
 * registered for the same user, so the pattern is a cheap early filter.
 */
const caseImageKeyListSchema = z
  .array(
    z
      .string()
      .max(300)
      .regex(/^case\/\d+\/[A-Za-z0-9-]+\.avif$/, { message: '图片信息无效' })
  )
  .max(CASE_IMAGE_MAX_PER_MESSAGE, {
    message: `每条说明最多 ${CASE_IMAGE_MAX_PER_MESSAGE} 张图片`
  })
  .refine((keys) => new Set(keys).size === keys.length, {
    message: '图片不能重复'
  })

export const caseImageKeysSchema = caseImageKeyListSchema.optional().default([])

export const caseMinimumLength = (kind: string) =>
  kind === 'content_violation'
    ? CASE_REPORT_MIN_LENGTH
    : CASE_DESCRIPTION_MIN_LENGTH

const minimumLengthMessage = (kind: string, minimum: number) =>
  kind === 'content_violation'
    ? `举报原因最少 ${minimum} 个字符`
    : `问题描述最少 ${minimum} 个字符`

/**
 * Unknown fields are stripped by Zod. Ownership, source, public visibility and
 * patch_id therefore cannot be supplied by a caller even if an old client
 * sends fields with those names. A site request has no target row, so its
 * `targetId` is ignored and pinned to 0.
 */
export const createCaseSchema = z
  .object({
    kind: caseKindSchema,
    targetType: caseTargetTypeSchema,
    targetId: z.unknown().optional(),
    expectedPatchId: idSchema.optional(),
    content: contentSchema,
    imageKeys: caseImageKeysSchema
  })
  .transform((input, ctx) => {
    const minimum = caseMinimumLength(input.kind)
    if (input.content.length < minimum) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_small,
        minimum,
        inclusive: true,
        type: 'string',
        path: ['content'],
        message: minimumLengthMessage(input.kind, minimum)
      })
    }
    if (input.targetType === 'site') {
      return { ...input, targetId: CASE_SITE_TARGET_ID }
    }
    const targetId = idSchema.safeParse(input.targetId)
    if (!targetId.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetId'],
        message: targetId.error.issues[0]?.message ?? 'ID 必须为正整数'
      })
      return z.NEVER
    }
    return { ...input, targetId: targetId.data }
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

const replyContentSchema = z
  .string({ message: '回复内容必须是文本' })
  .trim()
  .min(CASE_MESSAGE_MIN_LENGTH, { message: '回复内容不能为空' })
  .max(CASE_CONTENT_MAX_LENGTH, {
    message: `回复内容最多 ${CASE_CONTENT_MAX_LENGTH} 个字符`
  })

export const appendCaseMessageSchema = z.object({
  caseId: caseIdSchema,
  content: replyContentSchema,
  imageKeys: caseImageKeysSchema
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

/** Reopening and review requests both carry the reporter's reason (D16, D19). */
const reasonSchema = z
  .string({ message: '理由必须是文本' })
  .trim()
  .min(CASE_MESSAGE_MIN_LENGTH, { message: '请写明理由' })
  .max(CASE_CONTENT_MAX_LENGTH, {
    message: `理由最多 ${CASE_CONTENT_MAX_LENGTH} 个字符`
  })

export const reopenCaseSchema = z.object({
  caseId: caseIdSchema,
  content: reasonSchema
})
export const reopenCaseBodySchema = reopenCaseSchema.omit({ caseId: true })

export const reviewCaseSchema = z.object({
  caseId: caseIdSchema,
  content: reasonSchema
})
export const reviewCaseBodySchema = reviewCaseSchema.omit({ caseId: true })

export const confirmCaseSchema = z.object({
  caseId: caseIdSchema,
  solved: z.boolean({ message: '请选择是否已解决' })
})
export const confirmCaseBodySchema = confirmCaseSchema.omit({ caseId: true })

export const proposeCaseSchema = z.object({
  caseId: caseIdSchema,
  resolution: caseResolutionSchema,
  content: reasonSchema
})
export const proposeCaseBodySchema = proposeCaseSchema.omit({ caseId: true })

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
  /**
   * `staff` is the station queue. `publisher` is the read-only oversight view
   * of publisher-owned cases (D22); it never feeds the unified inbox.
   */
  ownerType: z.enum(CASE_OWNER_TYPES).default('staff'),
  ownerId: idSchema.optional(),
  page: z.coerce.number().int().min(1).max(2147483647).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(300).default(''),
  /** Which field the search matches; `all` matches every one of them. */
  searchField: z.enum(CASE_SEARCH_FIELDS).default('all')
})

export const adminCaseHandleSchema = z.object({
  caseId: caseIdSchema,
  action: z.enum(CASE_ADMIN_ACTIONS),
  resolution: caseResolutionSchema.optional(),
  content: contentSchema.optional().default(''),
  handledUserConfirmed: z.boolean().optional(),
  /**
   * Reply only: images uploaded through the case image endpoint. Closing
   * notes carry none (D30), so there is no default to add to other actions.
   */
  imageKeys: caseImageKeyListSchema.optional(),
  /**
   * Reply only. false keeps the turn with the site administrator instead of
   * handing the case to the reporter (D28); absent keeps the default.
   */
  awaitReporter: z.boolean().optional()
})
export const adminCaseHandleBodySchema = adminCaseHandleSchema.omit({
  caseId: true
})

/** Hide or unhide one reply or later-reporter note (D27). */
export const adminCaseMessageHideSchema = z.object({
  caseId: caseIdSchema,
  messageId: caseIdSchema,
  hidden: z.boolean({ message: '请选择隐藏或取消隐藏' })
})
export const adminCaseMessageHideBodySchema = adminCaseMessageHideSchema.omit({
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
