import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { patchUpdateSchema } from '~/validations/edit'
import { handleBatchPatchTags } from './batchTag'
import { uploadPatchGalleryImage, uploadPatchBanner } from './_upload'
import { purgePatchBannerCache } from '~/app/api/utils/purgeCache'
import { pLimit } from '~/utils/pLimit'

export const updateGalgame = async (
  input: z.infer<typeof patchUpdateSchema>,
  uid: number
) => {
  const patch = await prisma.patch.findUnique({ where: { id: input.id } })
  if (!patch) {
    return '该 ID 下未找到对应 Galgame'
  }

  if (input.vndbId && input.isDuplicate !== 'true') {
    const galgame = await prisma.patch.findFirst({
      where: { vndb_id: input.vndbId }
    })
    if (galgame && galgame.id !== input.id) {
      return `Galgame VNDB ID 与游戏 ID 为 ${galgame.unique_id} 的游戏重复`
    }
  }

  const { id, vndbId, name, alias, introduction, contentLimit, released } =
    input

  await prisma.patch.update({
    where: { id },
    data: {
      name,
      vndb_id: vndbId ? vndbId : null,
      introduction,
      content_limit: contentLimit,
      released
    }
  })

  await prisma.$transaction(async (prisma) => {
    await prisma.patch_alias.deleteMany({
      where: { patch_id: id }
    })

    const aliasData = alias.map((name) => ({
      name,
      patch_id: id
    }))

    await prisma.patch_alias.createMany({
      data: aliasData,
      skipDuplicates: true
    })
  })

  if (input.banner) {
    const buffer = await input.banner.arrayBuffer()
    const res = await uploadPatchBanner(buffer, id)
    if (typeof res === 'string') {
      return res
    }
    await purgePatchBannerCache(id)

    // Update the banner URL in the database to ensure it's correct
    // and to potentially trigger any update hooks if they exist
    const timestamp = Date.now()
    const imageLink = `${process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL}/patch/${id}/banner/banner.avif?t=${timestamp}`
    await prisma.patch.update({
      where: { id },
      data: { banner: imageLink }
    })
  } const { gallery, galleryMetadata } = input

  if (galleryMetadata) {
    const metadata = JSON.parse(galleryMetadata) as {
      keep: { id: number; is_nsfw: boolean }[]
      new: { id: string; is_nsfw: boolean }[]
      watermark?: boolean
    }

    const currentImages = await prisma.patch_game_image.findMany({
      where: { patch_id: id }
    })
    const keepIds = new Set(metadata.keep.map((k) => k.id))

    const toDelete = currentImages.filter((img) => !keepIds.has(img.id))
    if (toDelete.length > 0) {
      await prisma.patch_game_image.deleteMany({
        where: { id: { in: toDelete.map((img) => img.id) } }
      })
    }

    const updatePromises = metadata.keep.map(async (keep) => {
      const current = currentImages.find((img) => img.id === keep.id)
      if (current && current.is_nsfw !== keep.is_nsfw) {
        await prisma.patch_game_image.update({
          where: { id: keep.id },
          data: { is_nsfw: keep.is_nsfw }
        })
      }
    })
    await Promise.all(updatePromises)

    if (gallery) {
      const files = Array.isArray(gallery) ? gallery : [gallery]
      const limit = pLimit(2)

      await Promise.all(
        files.map((file, i) =>
          limit(async () => {
            const meta = metadata.new[i]
            if (!meta) return

            const galleryRecord = await prisma.patch_game_image.create({
              data: {
                url: '',
                is_nsfw: meta.is_nsfw,
                patch_id: id
              }
            })

            const buffer = await file.arrayBuffer()
            const uploadRes = await uploadPatchGalleryImage(
              buffer,
              id,
              galleryRecord.id,
              metadata.watermark ?? false
            )

            if (typeof uploadRes === 'string') {
              throw new Error(`Gallery upload failed: ${uploadRes}`)
            }

            const imageUrl = `${process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL}/patch/${id}/gallery/${galleryRecord.id}.avif`

            await prisma.patch_game_image.update({
              where: { id: galleryRecord.id },
              data: { url: imageUrl }
            })
          })
        )
      )
    }
  }

  if (input.tag.length) {
    await handleBatchPatchTags(input.id, input.tag, uid)
  }

  return {}
}
