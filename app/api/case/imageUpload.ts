import { randomUUID } from 'crypto'
import sharp from 'sharp'
import { checkBufferSize } from '~/app/api/utils/checkBufferSize'
import { deleteFileFromS3, uploadImageToS3 } from '~/lib/s3'
import { CASE_IMAGE_ALLOWED_TYPES } from '~/constants/case'
import { GALLERY_IMAGE_MAX_SIZE_MB } from '~/constants/galgame'
import type { CaseImageUploadResponse } from '~/types/api/case'
import { checkCaseRateLimit } from './rateLimit'

/**
 * Reporter images (D11) follow the private-chat image flow: the upload writes
 * an AVIF object and a short-lived Redis registration; a later create or reply
 * request consumes the registration atomically, so a client can only attach
 * keys this server produced for the same user, and each key only once.
 */
const CASE_IMAGE_UPLOAD_TTL_SECONDS = 60 * 60
const MAX_CASE_IMAGE_BYTES = GALLERY_IMAGE_MAX_SIZE_MB * 1024 * 1024
const MAX_CASE_AVIF_SIZE_MB = 1.5
export const CASE_IMAGE_SIZE_LIMIT_MESSAGE = `图片大小不能超过 ${GALLERY_IMAGE_MAX_SIZE_MB} MB`

const CONSUME_SCRIPT = `
  for i = 1, #KEYS do
    if redis.call("EXISTS", KEYS[i]) == 0 then
      return i
    end
  end
  redis.call("DEL", unpack(KEYS))
  return 0
`

export const caseImageUrl = (key: string) =>
  `${process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL}/${key}`

const registrationKey = (uid: number, key: string) =>
  `case:image-upload:${uid}:${key}`

const ownsKey = (uid: number, key: string) => key.startsWith(`case/${uid}/`)

const processCaseImage = async (buffer: Buffer) =>
  sharp(buffer)
    .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
    .avif({ quality: 60, effort: 3 })
    .toBuffer()

export const uploadCaseImage = async (
  file: File,
  uid: number
): Promise<CaseImageUploadResponse | string> => {
  if (!(CASE_IMAGE_ALLOWED_TYPES as readonly string[]).includes(file.type)) {
    return '仅支持 JPG、PNG、WebP、AVIF 图片'
  }
  if (file.size > MAX_CASE_IMAGE_BYTES) {
    return CASE_IMAGE_SIZE_LIMIT_MESSAGE
  }

  const limited = await checkCaseRateLimit('image-upload', uid)
  if (limited) return limited

  let processed: Buffer
  try {
    processed = await processCaseImage(Buffer.from(await file.arrayBuffer()))
  } catch (error) {
    console.error('Failed to process case image upload', { uid, error })
    return '图片处理失败，请重新选择有效图片'
  }
  if (!checkBufferSize(processed, MAX_CASE_AVIF_SIZE_MB)) {
    return '图片压缩后仍超过 1.5 MB'
  }

  const key = `case/${uid}/${Date.now()}-${randomUUID()}.avif`
  try {
    await uploadImageToS3(key, processed, 'image/avif')
  } catch (error) {
    console.error('Failed to upload case image', { uid, key, error })
    return '图片上传到对象存储失败，请稍后重试'
  }

  try {
    const { setKv } = await import('~/lib/redis')
    await setKv(registrationKey(uid, key), key, CASE_IMAGE_UPLOAD_TTL_SECONDS)
  } catch (error) {
    try {
      await deleteFileFromS3(key)
    } catch (deleteError) {
      console.error('Failed to delete unregistered case image', {
        key,
        error: deleteError
      })
    }
    console.error('Failed to register case image upload', { uid, error })
    return '图片上传记录保存失败，请稍后重试'
  }

  return { key, url: caseImageUrl(key) }
}

/** Returns an error string, or null once every key has been consumed. */
export const consumeCaseImageUploads = async (
  uid: number,
  keys: readonly string[]
): Promise<string | null> => {
  if (!keys.length) return null
  if (keys.some((key) => !ownsKey(uid, key))) return '图片信息无效，请重新上传'

  const { getPrefixedRedisKey, redis, runRedisCommand } = await import(
    '~/lib/redis'
  )
  try {
    const missing = await runRedisCommand(() =>
      redis.eval(
        CONSUME_SCRIPT,
        keys.length,
        ...keys.map((key) => getPrefixedRedisKey(registrationKey(uid, key)))
      )
    )
    return Number(missing) === 0 ? null : '图片已过期，请重新上传'
  } catch (error) {
    console.error('Failed to consume case image uploads', { uid, error })
    return '图片校验失败，请稍后重试'
  }
}

/** Best effort: give consumed keys back when the business write did not land. */
export const restoreCaseImageUploads = async (
  uid: number,
  keys: readonly string[]
) => {
  if (!keys.length) return
  try {
    const { setKv } = await import('~/lib/redis')
    await Promise.all(
      keys.map((key) =>
        setKv(registrationKey(uid, key), key, CASE_IMAGE_UPLOAD_TTL_SECONDS)
      )
    )
  } catch (error) {
    console.error('Failed to restore case image uploads', { uid, error })
  }
}
