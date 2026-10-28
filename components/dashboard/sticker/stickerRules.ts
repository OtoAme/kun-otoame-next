import {
  stickerPackDescriptionSchema,
  stickerPackNameSchema,
  stickerPackSlugSchema
} from '~/validations/sticker'
import type { AdminSticker, AdminStickerPack } from '~/types/api/admin'

// Mirrors lib/stickerAssets.ts, which is server-only; the import route
// enforces the same limits.
export const STICKER_LIMITS = {
  maxItems: 200,
  staticBytes: 512 * 1024,
  webmBytes: 300 * 1024,
  zipBytes: 32 * 1024 * 1024,
  totalBytes: 64 * 1024 * 1024
}
export const STICKER_ACCEPT =
  '.webp,.webm,.zip,image/webp,video/webm,application/zip'

export type PackFields = { slug: string; name: string; description: string }
export type PackErrors = Partial<Record<keyof PackFields, string>>

const firstIssue = (
  schema:
    | typeof stickerPackSlugSchema
    | typeof stickerPackNameSchema
    | typeof stickerPackDescriptionSchema,
  value: string
) => {
  const parsed = schema.safeParse(value)
  return parsed.success ? undefined : parsed.error.issues[0]?.message
}

export const validatePack = (
  form: PackFields,
  includeSlug: boolean
): PackErrors => ({
  ...(includeSlug
    ? { slug: firstIssue(stickerPackSlugSchema, form.slug) }
    : {}),
  name: firstIssue(stickerPackNameSchema, form.name),
  description: firstIssue(stickerPackDescriptionSchema, form.description)
})

export const hasErrors = (errors: PackErrors) =>
  Object.values(errors).some(Boolean)

/** A sticker counts toward enabling a pack only with a usable asset. */
export const isValidSticker = (sticker: AdminSticker) =>
  sticker.status === 1 &&
  sticker.assetKey.trim().length > 0 &&
  sticker.width > 0 &&
  sticker.height > 0 &&
  sticker.size > 0 &&
  (sticker.mediaType !== 'video' || Boolean(sticker.thumbnailKey))

export const enableBlocker = (pack: AdminStickerPack) => {
  if (pack.status === 1) return ''
  const valid = pack.stickers.filter(isValidSticker)
  if (!valid.length) return 'Pack 至少需要一张有效 Sticker 才能启用'
  if (
    pack.coverStickerId &&
    !valid.some((sticker) => sticker.id === pack.coverStickerId)
  ) {
    return '请先选择 Pack 内有效的封面 Sticker'
  }
  return ''
}

export const fileLimit = (file: File) => {
  const name = file.name.toLowerCase()
  if (name.endsWith('.zip')) return STICKER_LIMITS.zipBytes
  if (name.endsWith('.webm')) return STICKER_LIMITS.webmBytes
  return STICKER_LIMITS.staticBytes
}

/** Client-side precheck with the server's limits; the server re-checks. */
export const checkFiles = (files: File[]) => {
  if (!files.length) return '请选择 WebP、WebM 或 ZIP 文件'
  if (files.length > STICKER_LIMITS.maxItems) {
    return `单次最多选择 ${STICKER_LIMITS.maxItems} 个文件`
  }
  const tooLarge = files.find((file) => file.size > fileLimit(file))
  if (tooLarge) {
    return `${tooLarge.name} 超过 ${formatSize(fileLimit(tooLarge))} 的上限`
  }
  const total = files.reduce((sum, file) => sum + file.size, 0)
  if (total > STICKER_LIMITS.totalBytes) {
    return `单次导入文件总大小不能超过 ${formatSize(STICKER_LIMITS.totalBytes)}`
  }
  return ''
}

export const formatSize = (size: number) =>
  size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.ceil(size / 1024))} KB`

export const stickerPreview = (sticker: AdminSticker) =>
  sticker.thumbnailUrl ??
  (sticker.mediaType === 'image' ? sticker.assetUrl : null)
