import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { closeLinkCases } from '~/app/api/case/linkHealth'
import {
  resourceMutationInclude,
  resourcePostCommit,
  ResourceMutationError,
  runResourceMutation
} from './resource/mutation'
import { deleteFileFromS3 } from '~/lib/s3'
import { extractS3Key } from '~/app/api/patch/resource/_helper'
import {
  invalidateCompanyCaches,
  invalidatePatchContentCache,
  invalidatePatchListCaches,
  invalidateTagCaches
} from '~/app/api/patch/cache'
import { deletePatchResourceLink } from '~/app/api/patch/resource/_helper'
import {
  PATCH_SUBMISSION_ASSET_PREFIX,
  enqueueSubmissionOrphanCleanupJobs,
  processSubmissionOrphanCleanupJobsBestEffort
} from '~/app/api/patch-submission/orphanCleanup'

const patchIdSchema = z.object({
  patchId: z.coerce.number().min(1).max(9999999)
})

export const deletePatchById = async (
  input: z.infer<typeof patchIdSchema>,
  uid?: number
) => {
  const { patchId } = input

  try {
    const result = await runResourceMutation(async (tx) => {
      const parents = await tx.$queryRaw<{ id: number }[]>(
        Prisma.sql`SELECT id FROM patch WHERE id=${patchId} FOR UPDATE`
      )
      if (!parents.length) throw new ResourceMutationError('未找到该游戏', 404)
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM patch_resource WHERE patch_id=${patchId} ORDER BY id ASC FOR UPDATE`
      )
      await tx.$queryRaw(
        Prisma.sql`SELECT l.id FROM patch_resource_link l JOIN patch_resource r ON r.id=l.resource_id WHERE r.patch_id=${patchId} ORDER BY l.id ASC FOR UPDATE OF l`
      )
      const patch = await tx.patch.findUnique({
        where: { id: patchId },
        include: {
          company: {
            select: {
              company_id: true
            }
          }
        }
      })
      if (!patch) throw new ResourceMutationError('未找到该游戏', 404)
      const companyIds = [
        ...new Set(patch.company.map((relation) => relation.company_id))
      ]

      const patchResources = await tx.patch_resource.findMany({
        where: { patch_id: patchId },
        include: resourceMutationInclude()
      })
      const s3Links = patchResources.flatMap((resource) =>
        resource.links.filter((link) => link.storage === 's3')
      )
      const s3Contents = Array.from(
        new Set(s3Links.map((link) => link.content))
      )

      const galleryImages = await tx.patch_game_image.findMany({
        where: { patch_id: patchId }
      })
      const galleryS3Keys = galleryImages.flatMap((img) => {
        const keys: string[] = []
        const key = extractS3Key(img.url)
        if (key) keys.push(key)
        if (img.thumbnail_url) {
          const thumbKey = extractS3Key(img.thumbnail_url)
          if (thumbKey) keys.push(thumbKey)
        }
        return keys
      })
      const bannerKey = patch.banner ? extractS3Key(patch.banner) : null
      const submissionBannerKeys = bannerKey?.startsWith(
        PATCH_SUBMISSION_ASSET_PREFIX
      )
        ? [
            bannerKey,
            bannerKey.replace(/banner\.avif$/, 'banner-mini.avif'),
            bannerKey.replace(/banner\.avif$/, 'banner-full.avif')
          ]
        : []
      const submissionGalleryKeys = galleryS3Keys.filter((key) =>
        key.startsWith(PATCH_SUBMISSION_ASSET_PREFIX)
      )
      const submissionAssetKeys = [
        ...new Set([...submissionBannerKeys, ...submissionGalleryKeys])
      ]
      const canonicalGalleryKeys = galleryS3Keys.filter(
        (key) => !key.startsWith(PATCH_SUBMISSION_ASSET_PREFIX)
      )

      await closeLinkCases(tx, {
        resourceIds: patchResources.map((resource) => resource.id),
        resolution: 'link_removed',
        actorType: 'staff',
        actorId: uid,
        now: new Date()
      })
      for (const resource of patchResources)
        await tx.patch_resource.delete({ where: { id: resource.id } })
      if (submissionAssetKeys.length)
        await enqueueSubmissionOrphanCleanupJobs(
          tx,
          submissionAssetKeys,
          'patch_delete'
        )
      await tx.patch.delete({ where: { id: patchId } })
      return {
        patch,
        companyIds,
        s3Contents,
        submissionAssetKeys,
        canonicalGalleryKeys
      }
    })
    await resourcePostCommit('patch-delete-submission-assets', () =>
      processSubmissionOrphanCleanupJobsBestEffort(
        result.submissionAssetKeys,
        'patch-delete'
      )
    )
    for (const content of result.s3Contents)
      await resourcePostCommit('patch-delete-resource-object', () =>
        deletePatchResourceLink(content)
      )
    for (const key of result.canonicalGalleryKeys)
      await resourcePostCommit('patch-delete-gallery-object', () =>
        deleteFileFromS3(key)
      )
    await Promise.all([
      resourcePostCommit('patch-delete-content-cache', () =>
        invalidatePatchContentCache(result.patch.unique_id)
      ),
      resourcePostCommit('patch-delete-list-cache', () =>
        invalidatePatchListCaches()
      ),
      resourcePostCommit('patch-delete-tag-cache', () => invalidateTagCaches()),
      result.companyIds.length
        ? resourcePostCommit('patch-delete-company-cache', () =>
            invalidateCompanyCaches()
          )
        : Promise.resolve()
    ])
    return {}
  } catch (error) {
    if (error instanceof ResourceMutationError) return error.message
    throw error
  }
}
