import { z } from 'zod'
import {
  BACKUP_SORTS,
  BACKUP_TABS,
  IGNORE_REASON_MAX,
  MERGE_BATCH_MAX,
  MERGE_TABS,
  OFFICIAL_MIRROR_PAGE_LIMIT,
  OFFICIAL_MIRROR_SECTIONS,
  PAIR_CLASSES
} from '~/types/api/officialMirror'

const resourceId = z.coerce
  .number({ message: '资源 ID 必须为数字' })
  .int()
  .min(1)
  .max(9999999)

const page = z.coerce.number().int().min(1).max(9999999).default(1)
const limit = z.coerce
  .number()
  .int()
  .min(1)
  .max(OFFICIAL_MIRROR_PAGE_LIMIT)
  .default(20)
const search = z.string().trim().max(300).optional().default('')
const section = z.enum(OFFICIAL_MIRROR_SECTIONS).optional()
const basis = z.string().regex(/^[a-f0-9]{64}$/, '核对基点无效')

export const backupListSchema = z.object({
  tab: z.enum(BACKUP_TABS),
  section,
  search,
  page,
  limit,
  sort: z.enum(BACKUP_SORTS).default('download_desc')
})

export const backupDetailSchema = z.object({
  resourceId
})

export const backupIgnoreSchema = z.object({
  resourceId,
  reason: z.string().trim().max(IGNORE_REASON_MAX).optional()
})

export const backupResourceSchema = z.object({
  resourceId
})

export const backupDismissSchema = z.object({
  resourceId,
  basis
})

export const mergeListSchema = z.object({
  tab: z.enum(MERGE_TABS),
  pairClass: z.enum(PAIR_CLASSES).optional(),
  section,
  search,
  page,
  limit
})

export const mergePairSchema = z.object({
  userResourceId: resourceId,
  staffResourceId: resourceId
})

export const mergePreviewSchema = mergePairSchema

export const mergeExecuteSchema = mergePairSchema.extend({
  basis,
  contentConfirmed: z.custom<true>(
    (value) => value === true,
    '尚未确认两张卡片是同一份内容'
  )
})

export const mergeBatchSchema = z.object({
  pairs: z.array(mergeExecuteSchema).min(1).max(MERGE_BATCH_MAX)
})

export const officialMirrorCacheRefreshSchema = z.object({
  uniqueIds: z
    .array(z.string().regex(/^[A-Za-z0-9]{8}$/))
    .min(1)
    .max(20),
  authorIds: z.array(resourceId).max(40)
})

export const officialMirrorResolveSchema = z.object({
  resourceId
})
