import { z } from 'zod'
import { createHash } from 'crypto'
import type { Prisma } from '@prisma/client'
import {
  GalgameCardSelectField,
  toGalgameCardCount
} from '~/constants/api/select'
import { prisma } from '~/prisma/index'
import { getOrSet } from '~/lib/redis'
import {
  GALGAME_LIST_CACHE_DURATION,
  TAG_LIST_CACHE_DURATION
} from '~/config/cache'
import { getPatchByTagSchema, getTagSchema } from '~/validations/tag'
import {
  buildGalgameDateFilter,
  buildGalgameOrderBy,
  buildGalgameWhere
} from '~/app/api/utils/galgameQuery'
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

      const [data, total] = await Promise.all([
        prisma.patch_tag.findMany({
          where: { id: { notIn: blockedTagIds } },
          take: limit,
          skip: offset,
          orderBy: { count: 'desc' }
        }),
        prisma.patch_tag.count({ where: { id: { notIn: blockedTagIds } } })
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

export const getPatchByTag = async (
  input: z.infer<typeof getPatchByTagSchema>,
  nsfwEnable: Prisma.patchWhereInput
) => {
  const cacheKey = `tag_galgame_list:${createHash('md5')
    .update(JSON.stringify({ input, nsfwEnable }))
    .digest('hex')}`

  return await getOrSet(
    cacheKey,
    async () => {
      const {
        tagId,
        page,
        limit,
        selectedType,
        selectedLanguage,
        selectedPlatform,
        minRatingCount,
        sortField,
        sortOrder
      } = input
      const offset = (page - 1) * limit
      const years = JSON.parse(input.yearString) as string[]
      const months = JSON.parse(input.monthString) as string[]
      const dateFilter = buildGalgameDateFilter(years, months)
      const patchWhere = buildGalgameWhere({
        selectedType,
        selectedLanguage,
        selectedPlatform,
        minRatingCount,
        visibilityWhere: nsfwEnable
      })

      const [data, total] = await Promise.all([
        prisma.patch.findMany({
          where: {
            ...dateFilter,
            ...patchWhere,
            tag: {
              some: {
                tag_id: tagId
              }
            }
          },
          select: GalgameCardSelectField,
          orderBy: buildGalgameOrderBy(sortField, sortOrder),
          take: limit,
          skip: offset
        }),
        prisma.patch.count({
          where: {
            ...dateFilter,
            ...patchWhere,
            tag: {
              some: {
                tag_id: tagId
              }
            }
          }
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

      return { galgames, total }
    },
    GALGAME_LIST_CACHE_DURATION
  )
}
