import { z } from 'zod'
import { imageFileSchema } from './file'
import {
  PATCH_SUBMISSION_GALLERY_MAX_COUNT,
  PATCH_SUBMISSION_REASON_MAX_LENGTH
} from '~/constants/patchSubmission'
import { PATCH_SUBMISSION_STATUSES } from '~/types/api/patchSubmission'

const submissionIdSchema = z.coerce
  .number({ message: '投稿 ID 不正确' })
  .int()
  .min(1)
  .max(9999999)

/**
 * A stable id the client keeps for one creation attempt, so retrying after a
 * timeout resolves to the draft that was already made instead of a second one.
 */
const requestIdSchema = z
  .string()
  .trim()
  .min(8, { message: '请求 ID 不合法' })
  .max(64, { message: '请求 ID 不合法' })
  .regex(/^[A-Za-z0-9_-]+$/, { message: '请求 ID 不合法' })

const optionalIdField = (label: string, pattern: RegExp) =>
  z
    .string()
    .max(10, { message: `${label} 最多 10 个字符` })
    .regex(pattern, { message: `${label} 格式不正确` })
    .optional()
    .default('')

const repeatedStrings = z
  .array(z.string().trim().min(1).max(500))
  .max(100)
  .optional()
  .default([])

/**
 * The draft form. Deliberately not derived from patchCreateSchema: that one
 * carries the cover file and admin-only affordances, while a submission stores
 * text now and uploads assets through their own endpoint.
 */
export const patchSubmissionPayloadSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: '游戏名称是必填项' })
    .max(1007, { message: '游戏名称最多 1007 个字符' }),
  introduction: z
    .string()
    .trim()
    .min(10, { message: '游戏介绍是必填项, 最少 10 个字符' })
    .max(100007, { message: '游戏介绍最多 100007 字' }),
  vndbId: optionalIdField('VNDB ID', /^(v\d+)?$/i).transform((value) =>
    value.toLowerCase()
  ),
  vndbRelationId: optionalIdField('VNDB Relation ID', /^(r\d+)?$/i).transform(
    (value) => value.toLowerCase()
  ),
  bangumiId: optionalIdField('Bangumi ID', /^(\d+)?$/),
  steamId: optionalIdField('Steam ID', /^(\d+)?$/),
  dlsiteCode: z
    .string()
    .trim()
    .max(107)
    .optional()
    .default('')
    .transform((value) => value.toUpperCase()),
  dlsiteCircleName: z.string().trim().max(1007).optional().default(''),
  dlsiteCircleLink: z.string().trim().max(1007).optional().default(''),
  vndbTags: repeatedStrings,
  vndbDevelopers: repeatedStrings,
  bangumiTags: repeatedStrings,
  bangumiDevelopers: repeatedStrings,
  steamTags: repeatedStrings,
  steamDevelopers: repeatedStrings,
  steamAliases: repeatedStrings,
  officialUrl: z.string().trim().max(1007).optional().default(''),
  alias: repeatedStrings,
  tag: repeatedStrings,
  released: z.string().trim().max(107).optional().default(''),
  contentLimit: z.enum(['sfw', 'nsfw']).default('sfw')
})

export const patchSubmissionCreateSchema = z.object({
  requestId: requestIdSchema,
  payload: patchSubmissionPayloadSchema,
  /** Where the external snapshot came from, kept so a reviewer can judge staleness. */
  externalSource: z.string().trim().max(64).optional().default('')
})

export const patchSubmissionUpdateSchema = z.object({
  submissionId: submissionIdSchema,
  /** Optimistic lock: autosave from a stale device must not overwrite. */
  revision: z.coerce.number().int().min(1),
  payload: patchSubmissionPayloadSchema,
  externalSource: z.string().trim().max(64).optional().default('')
})

export const patchSubmissionIdSchema = z.object({
  submissionId: submissionIdSchema
})

export const patchSubmissionListSchema = z.object({
  page: z.coerce.number().int().min(1).max(9999).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20)
})

/**
 * Uploads validate the file with imageFileSchema like every other upload path,
 * and carry the client asset id so a retry lands on the same row.
 */
export const patchSubmissionGalleryUploadSchema = z.object({
  submissionId: submissionIdSchema,
  clientAssetId: requestIdSchema,
  image: imageFileSchema,
  isNSFW: z.enum(['true', 'false']).default('false'),
  displayOrder: z.coerce.number().int().min(0).max(
    PATCH_SUBMISSION_GALLERY_MAX_COUNT - 1
  ).default(0)
})

export const patchSubmissionBannerUploadSchema = z.object({
  submissionId: submissionIdSchema,
  banner: imageFileSchema,
  bannerOriginal: imageFileSchema.optional()
})

export const patchSubmissionGalleryDeleteSchema = z.object({
  submissionId: submissionIdSchema,
  galleryId: z.coerce.number().int().min(1).max(9999999)
})

const reviewReasonSchema = z
  .string()
  .trim()
  .min(1, { message: '请填写原因' })
  .max(PATCH_SUBMISSION_REASON_MAX_LENGTH, {
    message: `原因最多 ${PATCH_SUBMISSION_REASON_MAX_LENGTH} 个字符`
  })

export const patchSubmissionApproveSchema = z.object({
  submissionId: submissionIdSchema,
  /** A super admin reviewing their own submission must say so explicitly. */
  overrideSelfReview: z.boolean().optional().default(false)
})

export const patchSubmissionRejectSchema = z.object({
  submissionId: submissionIdSchema,
  reason: reviewReasonSchema,
  overrideSelfReview: z.boolean().optional().default(false)
})

export const patchSubmissionRequestChangesSchema = patchSubmissionRejectSchema

export const patchSubmissionViolateSchema = patchSubmissionRejectSchema

export const patchSubmissionAdminListSchema = z.object({
  page: z.coerce.number().int().min(1).max(9999).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(PATCH_SUBMISSION_STATUSES).optional(),
  /** Matches a title, an author name or any external id. */
  query: z.string().trim().max(107).optional().default('')
})
