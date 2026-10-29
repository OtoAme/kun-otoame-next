import { z } from 'zod'
import {
  HELP_GAME_LINK_MAX,
  HELP_GAME_LINK_MAX_LENGTH,
  isHttpUrl,
  normalizeHelpGameLinks
} from '~/utils/helpGameLinks'
import {
  HELP_ANSWER_MAX_LENGTH,
  HELP_CATEGORIES,
  HELP_CONTENT_MAX_LENGTH,
  HELP_CONTENT_MIN_LENGTH,
  HELP_GAME_NAME_MAX_LENGTH,
  HELP_REPLY_MAX_LENGTH,
  HELP_SCOPES,
  HELP_SORTS,
  HELP_STATUSES,
  HELP_TITLE_MAX_LENGTH,
  HELP_TITLE_MIN_LENGTH
} from '~/constants/help'

const idSchema = z.coerce
  .number({ message: 'ID 必须为数字' })
  .int({ message: 'ID 必须为整数' })
  .min(1, { message: 'ID 必须为正整数' })
  .max(2147483647)

const requestIdSchema = z.string().uuid({ message: '请求 ID 必须为 UUID' })

const titleSchema = z
  .string({ message: '标题必须是文本' })
  .trim()
  .min(HELP_TITLE_MIN_LENGTH, {
    message: `标题最少 ${HELP_TITLE_MIN_LENGTH} 个字符`
  })
  .max(HELP_TITLE_MAX_LENGTH, {
    message: `标题最多 ${HELP_TITLE_MAX_LENGTH} 个字符`
  })

const postContentSchema = z
  .string({ message: '正文必须是文本' })
  .trim()
  .min(HELP_CONTENT_MIN_LENGTH, {
    message: `正文最少 ${HELP_CONTENT_MIN_LENGTH} 个字符`
  })
  .max(HELP_CONTENT_MAX_LENGTH, {
    message: `正文最多 ${HELP_CONTENT_MAX_LENGTH} 个字符`
  })

const answerContentSchema = z
  .string({ message: '回答必须是文本' })
  .trim()
  .min(1, { message: '回答不能为空' })
  .max(HELP_ANSWER_MAX_LENGTH, {
    message: `回答最多 ${HELP_ANSWER_MAX_LENGTH} 个字符`
  })

const gameNameSchema = z
  .string()
  .trim()
  .max(HELP_GAME_NAME_MAX_LENGTH, {
    message: `游戏名最多 ${HELP_GAME_NAME_MAX_LENGTH} 个字符`
  })

/**
 * The game link is optional. An existing entry and a free-text game name are
 * mutually exclusive; a resource is only extra context and must belong to the
 * linked entry, which the service checks.
 */
const gameLinksSchema = z
  .array(
    z
      .string()
      .trim()
      .max(HELP_GAME_LINK_MAX_LENGTH, { message: '资料链接过长' })
  )
  .max(HELP_GAME_LINK_MAX, {
    message: `资料链接最多 ${HELP_GAME_LINK_MAX} 个`
  })
  .transform(normalizeHelpGameLinks)
  .refine((links) => links.every(isHttpUrl), {
    message: '资料链接需要以 http:// 或 https:// 开头'
  })

const linkFields = {
  patchId: idSchema.nullable().optional(),
  gameName: gameNameSchema.optional().default(''),
  gameLinks: gameLinksSchema.optional().default([]),
  resourceId: idSchema.nullable().optional()
}

const refineLink = (
  input: {
    patchId?: number | null
    gameName: string
    gameLinks: string[]
    resourceId?: number | null
  },
  ctx: z.RefinementCtx
) => {
  if (input.gameLinks.length && !input.gameName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['gameLinks'],
      message: '资料链接只在填写游戏名时使用'
    })
  }
  if (input.patchId && input.gameName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['gameName'],
      message: '已关联站内游戏时不需要再填写游戏名'
    })
  }
  if (input.resourceId && !input.patchId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['resourceId'],
      message: '关联资源时必须同时关联该资源所在的游戏'
    })
  }
}

export const helpPostCreateSchema = z
  .object({
    requestId: requestIdSchema,
    category: z.enum(HELP_CATEGORIES, { message: '请选择分类' }),
    title: titleSchema,
    content: postContentSchema,
    ...linkFields
  })
  .superRefine(refineLink)

export const helpPostUpdateSchema = z
  .object({
    postId: idSchema,
    category: z.enum(HELP_CATEGORIES, { message: '请选择分类' }),
    title: titleSchema,
    content: postContentSchema,
    ...linkFields
  })
  .superRefine(refineLink)

export const helpPostIdSchema = z.object({ postId: idSchema })
export const helpAnswerIdSchema = z.object({ answerId: idSchema })

export const helpAnswerCreateSchema = z.object({
  postId: idSchema,
  requestId: requestIdSchema,
  content: answerContentSchema
})

export const helpAnswerUpdateSchema = z.object({
  answerId: idSchema,
  content: answerContentSchema
})

/** `answerId: null` cancels the current acceptance. */
export const helpAcceptSchema = z.object({
  postId: idSchema,
  answerId: idSchema.nullable()
})

export const helpToggleSchema = z.object({
  active: z.boolean()
})

export const helpListSchema = z.object({
  page: z.coerce.number().int().min(1).max(9999999).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  category: z.enum(HELP_CATEGORIES).optional(),
  status: z.enum(HELP_STATUSES).optional(),
  patchId: idSchema.optional(),
  sort: z.enum(HELP_SORTS).default('latest'),
  scope: z.enum(HELP_SCOPES).default('all')
})

export const helpSimilarSchema = z.object({
  title: z.string().trim().max(HELP_TITLE_MAX_LENGTH).default(''),
  patchId: idSchema.optional()
})

const replyContentSchema = z
  .string({ message: '回复必须是文本' })
  .trim()
  .min(1, { message: '回复不能为空' })
  .max(HELP_REPLY_MAX_LENGTH, {
    message: `回复最多 ${HELP_REPLY_MAX_LENGTH} 个字符`
  })

/** `replyToUserId` names whom a reply answers; the service checks it. */
export const helpReplyCreateSchema = z.object({
  answerId: idSchema,
  requestId: requestIdSchema,
  content: replyContentSchema,
  replyToUserId: idSchema.nullable().optional()
})

export const helpReplyUpdateSchema = z.object({
  replyId: idSchema,
  content: replyContentSchema
})

export const helpReplyIdSchema = z.object({ replyId: idSchema })

export const helpSidebarSchema = z.object({
  status: z.enum(HELP_STATUSES).optional(),
  scope: z.enum(HELP_SCOPES).default('all')
})
