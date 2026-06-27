import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import { deleteFileFromS3 } from '~/lib/s3'
import { extractS3Key } from '~/app/api/patch/resource/_helper'
import {
  invalidateCompanyCaches,
  invalidatePatchContentCache,
  invalidatePatchListCaches
} from '~/app/api/patch/cache'
import { deletePatchResourceLink } from '~/app/api/patch/resource/_helper'

const patchIdSchema = z.object({
  patchId: z.coerce.number().min(1).max(9999999)
})

export const deletePatchById = async (input: z.infer<typeof patchIdSchema>) => {
  const { patchId } = input

  const patch = await prisma.patch.findUnique({
    where: { id: patchId },
    include: {
      company: {
        select: {
          company_id: true
        }
      }
    }
  })
  if (!patch) {
    return '未找到该游戏'
  }
  const companyIds = [
    ...new Set(patch.company.map((relation) => relation.company_id))
  ]

  const patchResources = await prisma.patch_resource.findMany({
    where: { patch_id: patchId },
    include: {
      links: true
    }
  })
  const s3Links = patchResources.flatMap((resource) =>
    resource.links.filter((link) => link.storage === 's3')
  )
  const s3Contents = Array.from(new Set(s3Links.map((link) => link.content)))

  const galleryImages = await prisma.patch_game_image.findMany({
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

  const result = await prisma.$transaction(async (prisma) => {
    if (patchResources.length > 0) {
      await Promise.all(
        patchResources.map(async (resource) => {
          await prisma.patch_resource.delete({
            where: { id: resource.id }
          })
        })
      )
    }

    await prisma.patch.delete({
      where: { id: patchId }
    })

    if (companyIds.length) {
      await prisma.$executeRaw`
        UPDATE "patch_company" c
        SET "count" = s."actual_count"
        FROM (
          SELECT c."id", COUNT(r."id")::int AS "actual_count"
          FROM "patch_company" c
          LEFT JOIN "patch_company_relation" r ON r."company_id" = c."id"
          WHERE c."id" IN (${Prisma.join(companyIds)})
          GROUP BY c."id"
        ) s
        WHERE c."id" = s."id"
      `
    }

    return {}
  })

  for (const content of s3Contents) {
    try {
      await deletePatchResourceLink(content)
    } catch (error) {
      console.error('[Upload] Failed to delete S3 object after patch delete', {
        content,
        patchId,
        error
      })
    }
  }

  for (const key of galleryS3Keys) {
    try {
      await deleteFileFromS3(key)
    } catch (error) {
      console.error(
        '[Upload] Failed to delete gallery S3 object after patch delete',
        { key, patchId, error }
      )
    }
  }

  await Promise.all([
    invalidatePatchContentCache(patch.unique_id),
    invalidatePatchListCaches(),
    companyIds.length ? invalidateCompanyCaches() : Promise.resolve()
  ])

  return result
}
