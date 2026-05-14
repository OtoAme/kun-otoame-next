import { z } from 'zod'
import { prisma } from '~/prisma/index'
import {
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
    where: { id: patchId }
  })
  if (!patch) {
    return '未找到该游戏'
  }

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

  await Promise.all([
    invalidatePatchContentCache(patch.unique_id),
    invalidatePatchListCaches()
  ])

  return result
}
