import { createHash } from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import { HomeResource } from '~/types/api/home'
import {
  GalgameCardSelectField,
  toGalgameCardCount
} from '~/constants/api/select'
import { HOME_CACHE_DURATION } from '~/config/cache'
import { getOrSet } from '~/lib/redis'
import { withRealtimePatchViews } from '~/app/api/patch/views/realtime'

export const getHomeData = async (nsfwEnable: Prisma.patchWhereInput) => {
  const cacheKey = `home_data:${createHash('md5')
    .update(JSON.stringify(nsfwEnable))
    .digest('hex')}`

  const result = await getOrSet(
    cacheKey,
    async () => {
      const [data, resourcesData] = await Promise.all([
        prisma.patch.findMany({
          orderBy: { created: 'desc' },
          where: nsfwEnable,
          select: GalgameCardSelectField,
          take: 20
        }),
        prisma.patch_resource.findMany({
          orderBy: { created: 'desc' },
          where: { patch: nsfwEnable, section: 'patch', status: 0 },
          include: {
            patch: {
              select: {
                name: true,
                unique_id: true
              }
            },
            user: {
              include: {
                _count: {
                  select: { patch_resource: true }
                }
              }
            },
            _count: {
              select: {
                like_by: true
              }
            }
          },
          take: 6
        })
      ])

      const galgames: GalgameCard[] = data.map((gal) => ({
        ...gal,
        tags: gal.tag.map((t) => t.tag.name).slice(0, 3),
        uniqueId: gal.unique_id,
        _count: toGalgameCardCount(gal),
        averageRating: gal.rating_stat?.avg_overall
          ? Math.round(gal.rating_stat.avg_overall * 10) / 10
          : 0
      }))

      const resources: HomeResource[] = resourcesData.map((resource) => ({
        id: resource.id,
        name: resource.name,
        section: resource.section,
        uniqueId: resource.patch.unique_id,
        storage: resource.storage,
        size: resource.size,
        type: resource.type,
        language: resource.language,
        note: resource.note.slice(0, 233),
        platform: resource.platform,
        likeCount: resource._count.like_by,
        download: resource.download,
        patchId: resource.patch_id,
        patchName: resource.patch.name,
        created: String(resource.created),
        user: {
          id: resource.user.id,
          name: resource.user.name,
          avatar: resource.user.avatar,
          patchCount: resource.user._count.patch_resource,
          role: resource.user.role
        }
      }))

      return { galgames, resources }
    },
    HOME_CACHE_DURATION,
    { staleTtl: 0 }
  )

  return {
    ...result,
    galgames: await withRealtimePatchViews(result.galgames)
  }
}
