import { z } from 'zod'

export const stickerPackSlugSchema = z
  .string()
  .trim()
  .min(1, { message: 'Pack 标识不能为空' })
  .max(100, { message: 'Pack 标识不能超过 100 个字符' })
  .regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/, {
    message: 'Pack 标识必须是小写 snake_case，例如 cute_cats'
  })

export const stickerPackNameSchema = z
  .string()
  .trim()
  .min(1, { message: 'Pack 展示名称不能为空' })
  .max(100, { message: 'Pack 展示名称不能超过 100 个字符' })

export const stickerPackDescriptionSchema = z
  .string()
  .trim()
  .max(500, { message: 'Pack 描述不能超过 500 个字符' })

export const adminStickerPackCreateSchema = z.object({
  slug: stickerPackSlugSchema,
  name: stickerPackNameSchema,
  description: stickerPackDescriptionSchema.default('')
})

export const adminStickerPackUpdateSchema = z.object({
  packId: z.coerce.number().int().min(1).max(9999999),
  name: stickerPackNameSchema,
  description: stickerPackDescriptionSchema.default(''),
  status: z.coerce
    .number()
    .int()
    .refine((value) => value === 0 || value === 1, {
      message: 'Pack 状态无效'
    }),
  coverStickerId: z.string().trim().min(1).max(100).nullable().optional()
})

export const adminStickerStatusSchema = z.object({
  stickerId: z.string().trim().min(1).max(100),
  status: z.coerce
    .number()
    .int()
    .refine((value) => value === 0 || value === 1, {
      message: 'Sticker 状态无效'
    })
})

const adminStickerIdsSchema = z
  .array(z.string().trim().min(1).max(100))
  .min(1, { message: '请至少选择一个 Sticker' })
  .max(200, { message: '单次最多操作 200 个 Sticker' })
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'Sticker 列表包含重复项'
  })

export const adminStickerBatchStatusSchema = z.object({
  stickerIds: adminStickerIdsSchema,
  status: z.coerce
    .number()
    .int()
    .refine((value) => value === 0 || value === 1, {
      message: 'Sticker 状态无效'
    })
})

export const adminStickerStatusRequestSchema = z.union([
  adminStickerStatusSchema,
  adminStickerBatchStatusSchema
])

export const adminStickerDeleteSchema = z.object({
  stickerIds: adminStickerIdsSchema
})

export const adminStickerPackDeleteSchema = z.object({
  packId: z.coerce.number().int().min(1).max(9999999)
})

export const adminStickerListSchema = z.object({
  packId: z.coerce.number().int().min(1).max(9999999).optional()
})
