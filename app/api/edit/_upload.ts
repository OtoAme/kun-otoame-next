import sharp from 'sharp'

import { deleteFileFromS3, uploadImageToS3 } from '~/lib/s3'
import { checkBufferSize } from '~/app/api/utils/checkBufferSize'
import { generateWatermarkSVG, watermarkConfig } from '~/config/watermark'

export interface PatchBannerUploadResult {
  imageLink: string
  uploadedKeys: string[]
}

const uploadBannerObject = async (
  key: string,
  buffer: Buffer,
  uploadedKeys: string[]
) => {
  await uploadImageToS3(key, buffer)
  uploadedKeys.push(key)
}

export const cleanupUploadedPatchBanner = async (uploadedKeys: string[]) => {
  await Promise.allSettled(
    uploadedKeys.map(async (key) => {
      try {
        await deleteFileFromS3(key)
      } catch (error) {
        console.error('[EditCreate] failed to cleanup uploaded banner', {
          key,
          error
        })
        throw error
      }
    })
  )
}

export const uploadPatchBanner = async (
  image: ArrayBuffer,
  id: number,
  originalImage?: ArrayBuffer
): Promise<string | PatchBannerUploadResult> => {
  if (image.byteLength === 0 || originalImage?.byteLength === 0) {
    return '上传文件不能为空'
  }

  const banner = await sharp(image)
    .resize(1920, 1080, {
      fit: 'inside',
      withoutEnlargement: true
    })
    .avif({ quality: 60, effort: 3 })
    .toBuffer()
  const miniBanner = await sharp(image)
    .resize(460, 259, {
      fit: 'inside',
      withoutEnlargement: true
    })
    .avif({ quality: 60, effort: 3 })
    .toBuffer()

  if (!checkBufferSize(miniBanner, 1.007)) {
    return '图片体积过大'
  }

  const bucketName = `patch/${id}/banner`
  const uploadedKeys: string[] = []

  try {
    await uploadBannerObject(`${bucketName}/banner.avif`, banner, uploadedKeys)
    await uploadBannerObject(
      `${bucketName}/banner-mini.avif`,
      miniBanner,
      uploadedKeys
    )

    if (originalImage) {
      const fullBanner = await sharp(originalImage)
        .avif({ quality: 60 })
        .toBuffer()
      await uploadBannerObject(
        `${bucketName}/banner-full.avif`,
        fullBanner,
        uploadedKeys
      )
    }
  } catch (error) {
    await cleanupUploadedPatchBanner(uploadedKeys)
    throw error
  }

  return {
    imageLink: `${process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL}/patch/${id}/banner/banner.avif`,
    uploadedKeys
  }
}

export const uploadPatchGalleryImage = async (
  image: ArrayBuffer,
  patchId: number,
  imageId: number,
  watermark: boolean
) => {
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

  if (!checkBufferSize(buffer, 1.5)) {
    return '图片体积过大'
  }

  const bucketName = `patch/${patchId}/gallery`
  await uploadImageToS3(`${bucketName}/${imageId}.avif`, buffer)
}
