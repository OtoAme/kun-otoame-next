import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { patchUpdateSchema } from '~/validations/edit'
import { uploadPatchBanner } from './_upload'
import { purgePatchBannerCache } from '~/app/api/utils/purgeCache'
import { invalidatePatchContentCache } from '~/app/api/patch/cache'
import { processSubmittedExternalData } from './processExternalData'

export const updateGalgame = async (
  input: z.infer<typeof patchUpdateSchema>,
  uid: number
) => {
  const patch = await prisma.patch.findUnique({ where: { id: input.id } })
  if (!patch) {
    return '该 ID 下未找到对应 OtomeGame'
  }

  if (input.vndbId && input.isDuplicate !== 'true') {
    const galgame = await prisma.patch.findFirst({
      where: { vndb_id: input.vndbId }
    })
    if (galgame && galgame.id !== input.id) {
      return `OtomeGame VNDB ID 与游戏 ID 为 ${galgame.unique_id} 的游戏重复`
    }
  }

  const normalizedDlsiteCode = input.dlsiteCode?.trim()
    ? input.dlsiteCode.trim().toUpperCase()
    : ''
  if (normalizedDlsiteCode) {
    const dlsitePatch = await prisma.patch.findFirst({
      where: { dlsite_code: normalizedDlsiteCode }
    })
    if (dlsitePatch && dlsitePatch.id !== input.id) {
      return `Galgame DLSite Code 与游戏 ID 为 ${dlsitePatch.unique_id} 的游戏重复`
    }
  }

  const {
    id,
    vndbId,
    vndbRelationId,
    bangumiId,
    steamId,
    dlsiteCircleName,
    dlsiteCircleLink,
    vndbTags,
    vndbDevelopers,
    bangumiTags,
    bangumiDevelopers,
    steamTags,
    steamDevelopers,
    steamAliases,
    name,
    alias,
    introduction,
    officialUrl,
    contentLimit,
    released
  } = input

  await prisma.patch.update({
    where: { id },
    data: {
      name,
      vndb_id: vndbId ? vndbId : null,
      vndb_relation_id: vndbRelationId ? vndbRelationId : null,
      bangumi_id: bangumiId ? Number(bangumiId) : null,
      steam_id: steamId ? Number(steamId) : null,
      dlsite_code: normalizedDlsiteCode ? normalizedDlsiteCode : null,
      introduction,
      official_url: officialUrl || '',
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
    const imageLink = `${process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL}/patch/${id}/banner/banner.avif`
    await prisma.patch.update({
      where: { id },
      data: { banner: imageLink }
    })
  }

  const { galleryMetadata } = input

  if (galleryMetadata) {
    const metadata = JSON.parse(galleryMetadata) as {
      keep: { id: number; is_nsfw: boolean }[]
      order?: (number | string)[]
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

    const orderMap = new Map<string | number, number>()
    if (metadata.order) {
      metadata.order.forEach((id, index) => orderMap.set(id, index))
    }

    const updatePromises = metadata.keep.map(async (keep) => {
      const current = currentImages.find((img) => img.id === keep.id)
      const newOrder = orderMap.get(keep.id) ?? 0
      if (current) {
        await prisma.patch_game_image.update({
          where: { id: keep.id },
          data: { is_nsfw: keep.is_nsfw, display_order: newOrder }
        })
      }
    })
    await Promise.all(updatePromises)
    await invalidatePatchContentCache(patch.unique_id)
  }

  await processSubmittedExternalData(
    id,
    {
      vndbTags,
      vndbDevelopers,
      bangumiTags,
      bangumiDevelopers,
      steamTags,
      steamDevelopers,
      steamAliases,
      dlsiteCircleName: dlsiteCircleName ?? '',
      dlsiteCircleLink: dlsiteCircleLink ?? ''
    },
    input.tag,
    uid
  )

  return {}
}
