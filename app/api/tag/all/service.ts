import { z } from 'zod'
import { createHash } from 'crypto'
import { prisma } from '~/prisma/index'
import { TAG_LIST_CACHE_DURATION } from '~/config/cache'
import { getOrSet } from '~/lib/redis'
import { getTagSchema } from '~/validations/tag'
import type { Tag } from '~/types/api/tag'

export const getTag = async (
  input: z.infer<typeof getTagSchema>,
  blockedTagIds: number[] = []
) => {
  const cacheKey = `tag_list:${createHash('md5')
    .update(JSON.stringify({ input, blockedTagIds }))
    .digest('hex')}`

  return await getOrSet(
    cacheKey,
    async () => {
      const { page, limit } = input
      const offset = (page - 1) * limit
      const where = blockedTagIds.length
        ? { id: { notIn: blockedTagIds } }
        : undefined

      const [data, total] = await Promise.all([
        prisma.patch_tag.findMany({
          where,
          take: limit,
          skip: offset,
          orderBy: { count: 'desc' }
        }),
        prisma.patch_tag.count({ where })
      ])

      const tags: Tag[] = data.map((tag) => ({
        id: tag.id,
        name: tag.name,
        count: tag.count,
        alias: tag.alias
      }))

      return { tags, total }
    },
    TAG_LIST_CACHE_DURATION
  )
}
