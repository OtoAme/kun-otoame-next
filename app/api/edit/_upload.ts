import sharp from 'sharp'

import { uploadImageToS3 } from '~/lib/s3'
import { checkBufferSize } from '~/app/api/utils/checkBufferSize'
import { generateWatermarkSVG, watermarkConfig } from '~/config/watermark'

export const uploadPatchBanner = async (image: ArrayBuffer, id: number) => {
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

  await Promise.all([
    uploadImageToS3(`${bucketName}/banner.avif`, banner),
    uploadImageToS3(`${bucketName}/banner-mini.avif`, miniBanner)
  ])
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
