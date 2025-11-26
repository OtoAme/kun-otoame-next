import sharp from 'sharp'

import { uploadImageToS3 } from '~/lib/s3'
import { checkBufferSize } from '~/app/api/utils/checkBufferSize'

export const uploadPatchBanner = async (image: ArrayBuffer, id: number) => {
  const banner = await sharp(image)
    .resize(1920, 1080, {
      fit: 'inside',
      withoutEnlargement: true
    })
    .avif({ quality: 60 })
    .toBuffer()
  const miniBanner = await sharp(image)
    .resize(460, 259, {
      fit: 'inside',
      withoutEnlargement: true
    })
    .avif({ quality: 60 })
    .toBuffer()

  if (!checkBufferSize(miniBanner, 1.007)) {
    return '图片体积过大'
  }

  const bucketName = `patch/${id}/banner`

  await uploadImageToS3(`${bucketName}/banner.avif`, banner)
  await uploadImageToS3(`${bucketName}/banner-mini.avif`, miniBanner)
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
    const svgImage = `
    <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
        fill="rgba(255, 255, 255, 0.12)" font-size="24" font-family="Arial" font-weight="bold"
        transform="rotate(-45, 100, 100)">OtoAme</text>
    </svg>
    `
    pipeline = pipeline.composite([
      {
        input: Buffer.from(svgImage),
        tile: true,
        blend: 'over'
      }
    ])
  }

  const buffer = await pipeline.avif({ quality: 60 }).toBuffer()

  if (!checkBufferSize(buffer, 1.5)) {
    return '图片体积过大'
  }

  const bucketName = `patch/${patchId}/gallery`
  await uploadImageToS3(`${bucketName}/${imageId}.avif`, buffer)
}
