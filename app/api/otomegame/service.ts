import { z } from 'zod'
import { createHash } from 'crypto'
import { prisma } from '~/prisma/index'
import { GalgameCardSelectField } from '~/constants/api/select'
import { galgameSchema } from '~/validations/galgame'
import { getOrSet } from '~/lib/redis'

export const getGalgame = async (
  input: z.infer<typeof galgameSchema>,
  nsfwEnable: Record<string, string | undefined>
) => {
  const cacheKey = `galgame_list:${createHash('md5')
    .update(JSON.stringify({ input, nsfwEnable }))
    .digest('hex')}`

  return await getOrSet(
    cacheKey,
    async () => {
      const {
        selectedType = 'all',
        selectedLanguage = 'all',
        selectedPlatform = 'all',
        sortField,
        sortOrder,
        page,
        limit
      } = input
      const years = JSON.parse(input.yearString) as string[]
      const months = JSON.parse(input.monthString) as string[]

      const offset = (page - 1) * limit

      let dateFilter = {}
      if (!years.includes('all')) {
        const dateConditions = []

        if (years.includes('future')) {
          dateConditions.push({ released: 'future' })
        }

        if (years.includes('unknown')) {
          dateConditions.push({ released: 'unknown' })
        }

        const nonFutureYears = years.filter((year) => year !== 'future')
        if (nonFutureYears.length > 0) {
          if (!months.includes('all')) {
            const yearMonthConditions = nonFutureYears.flatMap((year) =>
              months.map((month) => ({
                released: {
                  startsWith: `${year}-${month}`
                }
              }))
            )
            dateConditions.push(...yearMonthConditions)
          } else {
            const yearConditions = nonFutureYears.map((year) => ({
              released: {
                startsWith: year
              }
            }))
            dateConditions.push(...yearConditions)
          }
        }

        if (dateConditions.length > 0) {
          dateFilter = { OR: dateConditions }
        }
      }

      const where = {
        ...(selectedType !== 'all' && { type: { has: selectedType } }),
        ...(selectedLanguage !== 'all' && { language: { has: selectedLanguage } }),
        ...(selectedPlatform !== 'all' && { platform: { has: selectedPlatform } }),
        ...nsfwEnable
      }

      const orderBy =
        sortField === 'favorite'
          ? { favorite_folder: { _count: sortOrder } }
          : { [sortField]: sortOrder }

      const [data, total] = await Promise.all([
        prisma.patch.findMany({
          take: limit,
          skip: offset,
          orderBy,
          where: {
            ...dateFilter,
            ...where
          },
          select: GalgameCardSelectField
        }),
        prisma.patch.count({
          where: {
            ...dateFilter,
            ...where
          }
        })
      ])

      const galgames: GalgameCard[] = data.map((gal) => ({
        id: gal.id,
        uniqueId: gal.unique_id,
        name: gal.name,
        banner: gal.banner,
        view: gal.view,
        download: gal.download,
        type: gal.type,
        language: gal.language,
        platform: gal.platform,
        tags: gal.tag.map((t) => t.tag.name).slice(0, 3),
        created: gal.created,
        _count: gal._count,
        averageRating: gal.rating_stat?.avg_overall
          ? Math.round(gal.rating_stat.avg_overall * 10) / 10
          : 0
      }))

      return { galgames, total }
    },
    10
  )
}
