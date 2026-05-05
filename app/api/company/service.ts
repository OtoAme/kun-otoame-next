import { z } from 'zod'
import { createHash } from 'crypto'
import { prisma } from '~/prisma'
import type { Prisma } from '@prisma/client'
import {
  createCompanySchema,
  getCompanyByIdSchema,
  getCompanySchema,
  getPatchByCompanySchema,
  searchCompanySchema,
  updateCompanySchema
} from '~/validations/company'
import { getOrSet } from '~/lib/redis'
import {
  COMPANY_DETAIL_CACHE_DURATION,
  COMPANY_LIST_CACHE_DURATION,
  GALGAME_LIST_CACHE_DURATION
} from '~/config/cache'
import { invalidateCompanyCaches } from '~/app/api/patch/cache'
import {
  GalgameCardSelectField,
  toGalgameCardCount
} from '~/constants/api/select'
import { withRealtimePatchViews } from '~/app/api/patch/views/realtime'

export const getCompany = async (input: z.infer<typeof getCompanySchema>) => {
  const cacheKey = `company_list:${createHash('md5')
    .update(JSON.stringify(input))
    .digest('hex')}`

  return await getOrSet(
    cacheKey,
    async () => {
      const { page, limit } = input
      const offset = (page - 1) * limit

      const [companies, total] = await Promise.all([
        prisma.patch_company.findMany({
          take: limit,
          skip: offset,
          select: {
            id: true,
            name: true,
            count: true,
            alias: true
          },
          orderBy: { count: 'desc' }
        }),
        prisma.patch_company.count()
      ])

      return { companies, total }
    },
    COMPANY_LIST_CACHE_DURATION
  )
}

export const searchCompany = async (
  input: z.infer<typeof searchCompanySchema>
) => {
  const { query } = input

  const companies = await prisma.patch_company.findMany({
    where: {
      AND: query.map((q) => ({
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { alias: { has: q } },
          { parent_brand: { has: q } }
        ]
      }))
    },
    select: {
      id: true,
      name: true,
      count: true,
      alias: true
    },
    take: 100
  })

  const fullQuery = query.join(' ').toLowerCase()
  return companies.sort((a, b) => {
    const nameA = a.name.toLowerCase()
    const nameB = b.name.toLowerCase()
    const scoreA = nameA === fullQuery ? 0 : nameA.startsWith(fullQuery) ? 1 : 2
    const scoreB = nameB === fullQuery ? 0 : nameB.startsWith(fullQuery) ? 1 : 2
    if (scoreA !== scoreB) return scoreA - scoreB
    return b.count - a.count
  })
}

export const getPatchByCompany = async (
  input: z.infer<typeof getPatchByCompanySchema>,
  nsfwEnable: Prisma.patchWhereInput
) => {
  const cacheKey = `company_galgame_list:${createHash('md5')
    .update(JSON.stringify({ input, nsfwEnable }))
    .digest('hex')}`

  const result = await getOrSet(
    cacheKey,
    async () => {
      const {
        companyId,
        page,
        limit,
        selectedType,
        selectedLanguage,
        selectedPlatform,
        sortField,
        sortOrder,
        yearString,
        monthString,
        minRatingCount
      } = input
      const years = JSON.parse(yearString) as string[]
      const months = JSON.parse(monthString) as string[]
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

        const concreteYears = years.filter(
          (year) => year !== 'future' && year !== 'unknown'
        )
        if (concreteYears.length > 0) {
          if (!months.includes('all')) {
            const yearMonthConditions = concreteYears.flatMap((year) =>
              months.map((month) => ({
                released: {
                  startsWith: `${year}-${month}`
                }
              }))
            )
            dateConditions.push(...yearMonthConditions)
          } else {
            const yearConditions = concreteYears.map((year) => ({
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
        company: {
          some: { company_id: companyId }
        },
        ...(selectedType !== 'all' && { type: { has: selectedType } }),
        ...(selectedLanguage !== 'all' && {
          language: { has: selectedLanguage }
        }),
        ...(selectedPlatform !== 'all' && {
          platform: { has: selectedPlatform }
        }),
        ...(sortField === 'rating' && {
          rating_stat: { count: { gte: minRatingCount } }
        }),
        ...dateFilter,
        ...nsfwEnable
      }

      const orderBy =
        sortField === 'favorite'
          ? { favorite_folder: { _count: sortOrder } }
          : sortField === 'rating'
            ? { rating_stat: { avg_overall: sortOrder } }
            : { [sortField]: sortOrder }

      const [data, total] = await Promise.all([
        prisma.patch.findMany({
          where,
          select: GalgameCardSelectField,
          orderBy,
          take: limit,
          skip: offset
        }),
        prisma.patch.count({
          where
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
    GALGAME_LIST_CACHE_DURATION,
    { staleTtl: 0 }
  )

  return {
    ...result,
    galgames: await withRealtimePatchViews(result.galgames)
  }
}

export const getCompanyById = async (
  input: z.infer<typeof getCompanyByIdSchema>
) => {
  const { companyId } = input
  const cacheKey = `company_detail:${companyId}`

  return await getOrSet(
    cacheKey,
    async () => {
      const company = await prisma.patch_company.findUnique({
        where: { id: companyId },
        select: {
          id: true,
          name: true,
          count: true,
          alias: true,
          introduction: true,
          primary_language: true,
          official_website: true,
          parent_brand: true,
          created: true,
          user: {
            select: {
              id: true,
              name: true,
              avatar: true
            }
          }
        }
      })
      if (!company) {
        return '未找到公司'
      }

      return company
    },
    COMPANY_DETAIL_CACHE_DURATION
  )
}

export const deleteCompany = async (
  input: z.infer<typeof getCompanyByIdSchema>
) => {
  try {
    await prisma.patch_company.delete({
      where: { id: input.companyId }
    })
  } catch {
    return '未找到对应的会社'
  }

  await invalidateCompanyCaches(input.companyId)

  return {}
}

export const rewriteCompany = async (
  input: z.infer<typeof updateCompanySchema>
) => {
  const {
    companyId,
    name,
    primary_language,
    introduction = '',
    alias = [],
    official_website = [],
    parent_brand = []
  } = input

  const existingCompany = await prisma.patch_company.findFirst({
    where: {
      OR: [{ name }, { alias: { has: name } }]
    }
  })
  if (existingCompany && existingCompany.id !== companyId) {
    return '这个会社已经存在了'
  }

  const newCompany = await prisma.patch_company.update({
    where: { id: companyId },
    data: {
      name,
      introduction,
      alias,
      primary_language,
      official_website,
      parent_brand
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          avatar: true
        }
      }
    }
  })

  await invalidateCompanyCaches(companyId)

  return newCompany
}

export const createCompany = async (
  input: z.infer<typeof createCompanySchema>,
  uid: number
) => {
  const {
    name,
    primary_language,
    introduction = '',
    alias = [],
    official_website = [],
    parent_brand = []
  } = input

  const existingCompany = await prisma.patch_company.findFirst({
    where: {
      OR: [{ name }, { alias: { has: name } }]
    }
  })
  if (existingCompany) {
    return '这个会社已经存在了'
  }

  const newCompany = await prisma.patch_company.create({
    data: {
      user_id: uid,
      name,
      introduction,
      alias,
      primary_language,
      official_website,
      parent_brand
    },
    select: {
      id: true,
      name: true,
      count: true,
      alias: true
    }
  })

  await invalidateCompanyCaches()

  return newCompany
}
