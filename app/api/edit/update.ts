import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { deleteFileFromS3 } from '~/lib/s3'
import { extractS3Key } from '~/app/api/patch/resource/_helper'
import { patchUpdateSchema } from '~/validations/edit'
import { uploadPatchBanner } from './_upload'
import { purgePatchBannerCache } from '~/app/api/utils/purgeCache'
import {
  invalidatePatchContentCache,
  invalidatePatchListCaches
} from '~/app/api/patch/cache'
import { processSubmittedExternalData } from './processExternalData'
import { applySteamOfficialUrlFallback } from '~/utils/externalIds'
import {
  findFirstUniqueExternalIdDuplicate,
  formatUniqueExternalIdDuplicateMessage,
  resolveUniqueExternalIdConstraintMessage
} from './uniqueExternalIds'
import {
  PATCH_SUBMISSION_ASSET_PREFIX,
  enqueueSubmissionOrphanCleanupJobs,
  processSubmissionOrphanCleanupJobsBestEffort
} from '~/app/api/patch-submission/orphanCleanup'

const isSubmissionAssetKey = (key: string) =>
  key.startsWith(PATCH_SUBMISSION_ASSET_PREFIX)

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
  const normalizedOfficialUrl = applySteamOfficialUrlFallback(
    officialUrl,
    steamId
  )

  const uniqueExternalIdDuplicate = await findFirstUniqueExternalIdDuplicate(
    { bangumiId, vndbRelationId, dlsiteCode: normalizedDlsiteCode },
    id
  )
  if (uniqueExternalIdDuplicate) {
    return formatUniqueExternalIdDuplicateMessage(
      uniqueExternalIdDuplicate.field,
      uniqueExternalIdDuplicate.patch.unique_id
    )
  }

  try {
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
        official_url: normalizedOfficialUrl,
        content_limit: contentLimit,
        released
      }
    })
  } catch (error) {
    const uniqueExternalIdMessage =
      await resolveUniqueExternalIdConstraintMessage(
        error,
        {
          bangumiId,
          vndbRelationId,
          dlsiteCode: normalizedDlsiteCode
        },
        id
      )
    if (uniqueExternalIdMessage) {
      return uniqueExternalIdMessage
    }
    throw error
  }

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
    const originalBuffer = input.bannerOriginal
      ? await input.bannerOriginal.arrayBuffer()
      : undefined
    const res = await uploadPatchBanner(buffer, id, originalBuffer)
    if (typeof res === 'string') {
      return res
    }
    await purgePatchBannerCache(id)

    const imageLink = `${process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL}/patch/${id}/banner/banner.avif`
    const previousBannerKey = extractS3Key(patch.banner)
    const submissionBannerKeys =
      previousBannerKey && isSubmissionAssetKey(previousBannerKey)
        ? [
            previousBannerKey,
            previousBannerKey.replace(/banner\.avif$/, 'banner-mini.avif'),
            previousBannerKey.replace(/banner\.avif$/, 'banner-full.avif')
          ]
        : []
    await prisma.$transaction(async (tx) => {
      await tx.patch.update({
        where: { id },
        data: { banner: imageLink }
      })
      if (submissionBannerKeys.length) {
        await enqueueSubmissionOrphanCleanupJobs(
          tx,
          submissionBannerKeys,
          'banner_replace'
        )
      }
    })
    await processSubmissionOrphanCleanupJobsBestEffort(
      submissionBannerKeys,
      'patch-rewrite-banner'
    )
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

    const deletedS3Keys = toDelete.flatMap((img) => {
      const keys: string[] = []
      const key = extractS3Key(img.url)
      if (key) keys.push(key)
      if (img.thumbnail_url) {
        const thumbKey = extractS3Key(img.thumbnail_url)
        if (thumbKey) keys.push(thumbKey)
      }
      return keys
    })

    const submissionKeys = deletedS3Keys.filter(isSubmissionAssetKey)
    const canonicalKeys = deletedS3Keys.filter(
      (key) => !isSubmissionAssetKey(key)
    )

    if (toDelete.length > 0) {
      await prisma.$transaction(async (tx) => {
        await tx.patch_game_image.deleteMany({
          where: { id: { in: toDelete.map((img) => img.id) } }
        })
        if (submissionKeys.length) {
          await enqueueSubmissionOrphanCleanupJobs(
            tx,
            submissionKeys,
            'gallery_delete'
          )
        }
      })
    }

    await processSubmissionOrphanCleanupJobsBestEffort(
      submissionKeys,
      'patch-rewrite-gallery'
    )

    if (canonicalKeys.length > 0) {
      await Promise.all(
        canonicalKeys.map((key) =>
          deleteFileFromS3(key).catch((error) => {
            console.error(
              '[Upload] Failed to delete gallery S3 object after rewrite',
              { key, error }
            )
          })
        )
      )
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
      vndbId,
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
  await Promise.all([
    invalidatePatchContentCache(patch.unique_id),
    invalidatePatchListCaches()
  ])

  return {}
}
