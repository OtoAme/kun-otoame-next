import { randomUUID } from 'crypto'
import sharp from 'sharp'
import { checkBufferSize } from '~/app/api/utils/checkBufferSize'
import { checkCaseRateLimit } from '~/app/api/case/rateLimit'
import { uploadImageToS3 } from '~/lib/s3'
import { GALLERY_IMAGE_MAX_SIZE_MB } from '~/constants/galgame'
import { HELP_IMAGE_ALLOWED_TYPES } from '~/constants/help'

/**
 * Images for help posts and answers. They follow the case image flow (same
 * types, size, AVIF conversion and fail-closed upload rate limit), but the
 * image is referenced from markdown, so there is no registration to consume:
 * an image uploaded and never posted stays in storage.
 */
const MAX_HELP_IMAGE_BYTES = GALLERY_IMAGE_MAX_SIZE_MB * 1024 * 1024
const MAX_HELP_AVIF_SIZE_MB = 1.5
export const HELP_IMAGE_SIZE_LIMIT_MESSAGE = `图片大小不能超过 ${GALLERY_IMAGE_MAX_SIZE_MB} MB`

export const helpImageUrl = (key: string) =>
  `${process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL}/${key}`

export const uploadHelpImage = async (
  file: File,
  uid: number
): Promise<{ url: string } | string> => {
  if (!(HELP_IMAGE_ALLOWED_TYPES as readonly string[]).includes(file.type)) {
    return '仅支持 JPG、PNG、WebP、AVIF 图片'
  }
  if (file.size > MAX_HELP_IMAGE_BYTES) return HELP_IMAGE_SIZE_LIMIT_MESSAGE

  // Shares the case upload bucket per user: both cost object storage.
  const limited = await checkCaseRateLimit('image-upload', uid)
  if (limited) return limited

  let processed: Buffer
  try {
    processed = await sharp(Buffer.from(await file.arrayBuffer()))
      .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
      .avif({ quality: 60, effort: 3 })
      .toBuffer()
  } catch (error) {
    console.error('Failed to process help image upload', { uid, error })
    return '图片处理失败，请重新选择有效图片'
  }
  if (!checkBufferSize(processed, MAX_HELP_AVIF_SIZE_MB)) {
    return '图片压缩后仍超过 1.5 MB'
  }

  const key = `help/${uid}/${Date.now()}-${randomUUID()}.avif`
  try {
    await uploadImageToS3(key, processed, 'image/avif')
  } catch (error) {
    console.error('Failed to upload help image', { uid, key, error })
    return '图片上传到对象存储失败，请稍后重试'
  }
  return { url: helpImageUrl(key) }
}
