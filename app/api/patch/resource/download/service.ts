import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { updatePatchResourceStatsSchema } from '~/validations/patch'
import {
  invalidatePatchContentCache,
  invalidatePatchListCaches
} from '~/app/api/patch/cache'
import { setRealtimePatchDownloadStats } from '~/app/api/patch/views/buffer'

export const downloadStats = async (
  input: z.infer<typeof updatePatchResourceStatsSchema>
) => {
  // 下载计数走原生 SQL, Prisma 的 @updatedAt 会在任何 update 上刷新 updated,
  // 纯统计不应改变资源的更新时间
  const result = await prisma.$transaction(async (prisma) => {
    const linkUpdateCount = await prisma.$executeRaw`
      UPDATE patch_resource_link
      SET download = download + 1
      WHERE id = ${input.linkId}
        AND resource_id = ${input.resourceId}
        AND EXISTS (
          SELECT 1
          FROM patch_resource
          WHERE patch_resource.id = patch_resource_link.resource_id
            AND patch_resource.patch_id = ${input.patchId}
            AND patch_resource.status = 0
        )
    `

    if (linkUpdateCount === 0) {
      return '未找到对应资源链接'
    }

    await prisma.$executeRaw`
      UPDATE patch_resource
      SET download = download + 1
      WHERE id = ${input.resourceId}
        AND patch_id = ${input.patchId}
        AND status = 0
    `

    const patchRows = await prisma.$queryRaw<
      { unique_id: string; download: number }[]
    >`
      UPDATE patch
      SET download = download + 1
      WHERE id = ${input.patchId}
      RETURNING unique_id, download
    `

    const patch = patchRows[0]
    if (!patch) {
      throw new Error('未找到对应游戏')
    }

    return { uniqueId: patch.unique_id, download: patch.download }
  })

  if (typeof result === 'string') {
    return result
  }

  await Promise.all([
    setRealtimePatchDownloadStats(result.uniqueId, result.download),
    invalidatePatchContentCache(result.uniqueId),
    invalidatePatchListCaches()
  ]).catch((error) => {
    console.error('Failed to invalidate patch download stats cache:', error)
  })

  return {}
}
