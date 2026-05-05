import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { updatePatchResourceStatsSchema } from '~/validations/patch'
import {
  invalidatePatchContentCache
} from '~/app/api/patch/cache'
import { setRealtimePatchDownloadStats } from '~/app/api/patch/views/buffer'

export const downloadStats = async (
  input: z.infer<typeof updatePatchResourceStatsSchema>
) => {
  const result = await prisma.$transaction(async (prisma) => {
    const resourceUpdate = await prisma.patch_resource.updateMany({
      where: {
        id: input.resourceId,
        patch_id: input.patchId,
        status: 0
      },
      data: { download: { increment: 1 } }
    })

    if (resourceUpdate.count === 0) {
      return '未找到对应资源'
    }

    const patch = await prisma.patch.update({
      where: { id: input.patchId },
      data: { download: { increment: 1 } },
      select: { unique_id: true, download: true }
    })

    return { uniqueId: patch.unique_id, download: patch.download }
  })

  if (typeof result === 'string') {
    return result
  }

  await Promise.all([
    setRealtimePatchDownloadStats(result.uniqueId, result.download),
    invalidatePatchContentCache(result.uniqueId)
  ]).catch((error) => {
    console.error('Failed to invalidate patch download stats cache:', error)
  })

  return {}
}
