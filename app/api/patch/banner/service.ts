import { prisma } from '~/prisma/index'
import { uploadPatchBanner } from '~/app/api/edit/_upload'
import { purgePatchBannerCache } from '~/app/api/utils/purgeCache'

export const updatePatchBanner = async (
  image: ArrayBuffer,
  patchId: number,
  originalImage?: ArrayBuffer
) => {
  const patch = await prisma.patch.findUnique({
    where: { id: patchId }
  })
  if (!patch) {
    return '这个 OtomeGame 不存在'
  }

  const res = await uploadPatchBanner(image, patchId, originalImage)
  if (typeof res === 'string') {
    return res
  }

  await purgePatchBannerCache(patchId)

  const imageLink = `${process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL}/patch/${patchId}/banner/banner.avif`
  await prisma.patch.update({
    where: { id: patchId },
    data: { banner: imageLink }
  })

  return {}
}
