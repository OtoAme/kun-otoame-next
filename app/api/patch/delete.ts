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

  const result = await prisma.$transaction(async (prisma) => {
    if (patchResources.length > 0) {
      await Promise.all(
        patchResources.map(async (resource) => {
          for (const link of resource.links) {
            if (link.storage === 's3') {
              await deletePatchResourceLink(
                link.content,
                resource.patch_id,
                link.hash
              )
            }
          }

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

  await Promise.all([
    invalidatePatchContentCache(patch.unique_id),
    invalidatePatchListCaches()
  ])

  return result
}
