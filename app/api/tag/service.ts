import { z } from 'zod'
import { createHash } from 'crypto'
import { GalgameCardSelectField } from '~/constants/api/select'
import { prisma } from '~/prisma/index'
import { getOrSet } from '~/lib/redis'
import { getPatchByTagSchema, getTagSchema } from '~/validations/tag'
import type { Tag } from '~/types/api/tag'

export const getTag = async (input: z.infer<typeof getTagSchema>) => {
  const cacheKey = `tag_list:${createHash('md5')
    .update(JSON.stringify(input))
    .digest('hex')}`

  return await getOrSet(
    cacheKey,
    async () => {
      const { page, limit } = input
      const offset = (page - 1) * limit

      const [data, total] = await Promise.all([
        prisma.patch_tag.findMany({
          take: limit,
          skip: offset,
          orderBy: { count: 'desc' }
        }),
        prisma.patch_tag.count()
      ])

      const tags: Tag[] = data.map((tag) => ({
        id: tag.id,
        name: tag.name,
        count: tag.count,
        alias: tag.alias
      }))

      return { tags, total }
    },
    10
  )
}

export const getPatchByTag = async (
  input: z.infer<typeof getPatchByTagSchema>,
  nsfwEnable: Record<string, string | undefined>
) => {
  const cacheKey = `tag_galgame_list:${createHash('md5')
    .update(JSON.stringify({ input, nsfwEnable }))
    .digest('hex')}`

  return await getOrSet(
    cacheKey,
    async () => {
      const { tagId, page, limit } = input
      const offset = (page - 1) * limit

      const [data, total] = await Promise.all([
        prisma.patch_tag_relation.findMany({
          where: { tag_id: tagId, patch: nsfwEnable },
          select: {
            patch: {
              select: GalgameCardSelectField
            }
          },
          orderBy: { patch: { [input.sortField]: 'desc' } },
          take: limit,
          skip: offset
        }),
        prisma.patch_tag_relation.count({
          where: { tag_id: tagId, patch: nsfwEnable }
        })
      ])

      const patches = data.map((p) => p.patch)
      const galgames: GalgameCard[] = patches.map((gal) => ({
        ...gal,
        tags: gal.tag.map((t) => t.tag.name).slice(0, 3),
        uniqueId: gal.unique_id,
        averageRating: gal.rating_stat?.avg_overall
          ? Math.round(gal.rating_stat.avg_overall * 10) / 10
          : 0
      }))

      return { galgames, total }
    },
    10
  )
}
