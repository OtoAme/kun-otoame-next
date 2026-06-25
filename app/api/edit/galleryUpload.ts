import sharp from 'sharp'

import { checkBufferSize } from '~/app/api/utils/checkBufferSize'
import { generateWatermarkSVG, watermarkConfig } from '~/config/watermark'
import { uploadImageToS3 } from '~/lib/s3'

const GALLERY_STATIC_MAX_SIZE_MB = 1.5
export const GALLERY_ANIMATED_MAX_SIZE_MB = 8

type GalleryUploadExtension = 'avif' | 'webp'
type GalleryUploadMode = 'processed' | 'original'

interface GalleryUploadPlanInput {
  format?: string
  pages?: number
  size: number
  watermark: boolean
  isAvifSequence?: boolean
}

interface GalleryUploadPlan {
  mode: GalleryUploadMode
  extension: GalleryUploadExtension
  contentType: `image/${GalleryUploadExtension}`
  skipWatermark: boolean
}

export interface UploadedGalleryImage {
  extension: GalleryUploadExtension
  contentType: `image/${GalleryUploadExtension}`
  skipWatermark: boolean
}

interface ProcessedGalleryImage extends UploadedGalleryImage {
  buffer: Buffer
}

const supportedStaticFormats = new Set([
  'jpeg',
  'jpg',
  'png',
  'webp',
  'avif'
])

const isSizeWithinLimit = (size: number, maxSizeInMegabyte: number) =>
  size <= maxSizeInMegabyte * 1024 * 1024

const readIsoBmffBrand = (buffer: Buffer, offset: number) =>
  buffer.subarray(offset, offset + 4).toString('ascii')

const hasIsoBmffBrand = (buffer: Buffer, brand: string) => {
  if (buffer.length < 16 || readIsoBmffBrand(buffer, 4) !== 'ftyp') {
    return false
  }

  const boxSize = buffer.readUInt32BE(0)
  const brandLimit = Math.min(boxSize > 0 ? boxSize : buffer.length, buffer.length)

  if (readIsoBmffBrand(buffer, 8) === brand) {
    return true
  }

  for (let offset = 16; offset + 4 <= brandLimit; offset += 4) {
    if (readIsoBmffBrand(buffer, offset) === brand) {
      return true
    }
  }

  return false
}

const isAvifFormat = (format: string | undefined, input?: Buffer) => {
  if (format === 'avif') {
    return true
  }

  if (format !== 'heif' || !input) {
    return false
  }

  return hasIsoBmffBrand(input, 'avif') || hasIsoBmffBrand(input, 'avis')
}

const normalizeGalleryFormat = (
  format: string | undefined,
  input?: Buffer
) => {
  if (isAvifFormat(format, input)) {
    return 'avif'
  }

  return format
}

export const isAnimatedAvifBuffer = (buffer: Buffer) =>
  hasIsoBmffBrand(buffer, 'avis')

export const getGalleryUploadPlan = (
  input: GalleryUploadPlanInput
): GalleryUploadPlan | string => {
  const format =
    input.isAvifSequence === true
      ? 'avif'
      : normalizeGalleryFormat(input.format)
  const isAnimated = (input.pages ?? 1) > 1 || input.isAvifSequence === true

  if (isAnimated) {
    if (format !== 'webp' && format !== 'avif') {
      return '暂不支持该动图格式'
    }

    if (!isSizeWithinLimit(input.size, GALLERY_ANIMATED_MAX_SIZE_MB)) {
      return `动图体积过大, 超过 ${GALLERY_ANIMATED_MAX_SIZE_MB}MB`
    }

    return {
      mode: 'original',
      extension: format,
      contentType: `image/${format}`,
      skipWatermark: true
    }
  }

  if (!format || !supportedStaticFormats.has(format)) {
    return '不支持的图片格式'
  }

  return {
    mode: 'processed',
    extension: 'avif',
    contentType: 'image/avif',
    skipWatermark: false
  }
}

const processStaticGalleryImage = async (
  image: Buffer,
  watermark: boolean
): Promise<Buffer | string> => {
  let pipeline = sharp(image).resize(1920, 1080, {
    fit: 'inside',
    withoutEnlargement: true
  })

  if (watermark) {
    const svgImage = generateWatermarkSVG()
    pipeline = pipeline.composite([
      {
        input: Buffer.from(svgImage),
        ...watermarkConfig.composite
      }
    ])
  }

  const buffer = await pipeline.avif({ quality: 60, effort: 3 }).toBuffer()

  if (!checkBufferSize(buffer, GALLERY_STATIC_MAX_SIZE_MB)) {
    return '图片体积过大'
  }

  return buffer
}

export const preparePatchGalleryImage = async (
  image: ArrayBuffer,
  watermark: boolean
): Promise<ProcessedGalleryImage | string> => {
  const input = Buffer.from(image)
  if (input.byteLength === 0) {
    return '上传文件不能为空'
  }

  if (isAnimatedAvifBuffer(input)) {
    const plan = getGalleryUploadPlan({
      format: 'heif',
      pages: 2,
      size: input.byteLength,
      watermark,
      isAvifSequence: true
    })

    if (typeof plan === 'string') {
      return plan
    }

    return {
      buffer: input,
      extension: plan.extension,
      contentType: plan.contentType,
      skipWatermark: plan.skipWatermark
    }
  }

  const metadata = await sharp(input, { pages: -1 }).metadata()
  const plan = getGalleryUploadPlan({
    format: normalizeGalleryFormat(metadata.format, input),
    pages: metadata.pages,
    size: input.byteLength,
    watermark
  })

  if (typeof plan === 'string') {
    return plan
  }

  if (plan.mode === 'original') {
    return {
      buffer: input,
      extension: plan.extension,
      contentType: plan.contentType,
      skipWatermark: plan.skipWatermark
    }
  }

  const buffer = await processStaticGalleryImage(input, watermark)
  if (typeof buffer === 'string') {
    return buffer
  }

  return {
    buffer,
    extension: plan.extension,
    contentType: plan.contentType,
    skipWatermark: plan.skipWatermark
  }
}

export const uploadPatchGalleryImage = async (
  image: ArrayBuffer,
  patchId: number,
  imageId: number,
  watermark: boolean
): Promise<UploadedGalleryImage | string> => {
  const result = await preparePatchGalleryImage(image, watermark)
  if (typeof result === 'string') {
    return result
  }

  const bucketName = `patch/${patchId}/gallery`
  await uploadImageToS3(
    `${bucketName}/${imageId}.${result.extension}`,
    result.buffer,
    result.contentType
  )

  return {
    extension: result.extension,
    contentType: result.contentType,
    skipWatermark: result.skipWatermark
  }
}
