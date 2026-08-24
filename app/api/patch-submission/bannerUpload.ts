import sharp from 'sharp'
import { uploadImageToS3 } from '~/lib/s3'
import { checkBufferSize } from '~/app/api/utils/checkBufferSize'

interface BannerVariantInput {
  prefix: string
  banner: ArrayBuffer
  bannerOriginal?: ArrayBuffer
}

/**
 * Produces the same three cover variants the published entry needs, under the
 * submission's own prefix, so approval can reference them without copying:
 * banner.avif for the detail hero, banner-mini.avif for list cards, and
 * banner-full.avif for the lightbox.
 *
 * banner-full is only written when an original is supplied, exactly like the
 * direct-publish path — which is why a submission without its original would
 * publish an entry whose lightbox image is missing.
 */
export const uploadPatchSubmissionBannerVariants = async (
  input: BannerVariantInput
) => {
  if (input.banner.byteLength === 0 || input.bannerOriginal?.byteLength === 0) {
    return '上传文件不能为空'
  }

  const banner = await sharp(input.banner)
    .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
    .avif({ quality: 60, effort: 3 })
    .toBuffer()
  const miniBanner = await sharp(input.banner)
    .resize(460, 259, { fit: 'inside', withoutEnlargement: true })
    .avif({ quality: 60, effort: 3 })
    .toBuffer()

  if (!checkBufferSize(miniBanner, 1.007)) {
    return '图片体积过大'
  }

  const bannerKey = `${input.prefix}/banner/banner.avif`
  const thumbnailKey = `${input.prefix}/banner/banner-mini.avif`

  await Promise.all([
    uploadImageToS3(bannerKey, banner),
    uploadImageToS3(thumbnailKey, miniBanner)
  ])

  let originalKey: string | null = null
  if (input.bannerOriginal) {
    const fullBanner = await sharp(input.bannerOriginal)
      .avif({ quality: 60 })
      .toBuffer()
    originalKey = `${input.prefix}/banner/banner-full.avif`
    await uploadImageToS3(originalKey, fullBanner)
  }

  return { bannerKey, thumbnailKey, originalKey }
}
