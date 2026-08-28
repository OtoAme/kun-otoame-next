import { z } from 'zod'
import { Prisma } from '@prisma/client'
import type { Prisma as PrismaType } from '@prisma/client'
import {
  GalgameCardSelectField,
  toGalgameCardCount
} from '~/constants/api/select'
import { withRealtimePatchViews } from '~/app/api/patch/views/realtime'
import { prisma } from '~/prisma/index'
import { searchSchema, searchTagSchema } from '~/validations/search'
import {
  buildGalgameDateFilter,
  buildGalgameOrderBy,
  buildGalgameWhere
} from '~/app/api/utils/galgameQuery'
import type { SearchSuggestionType } from '~/types/api/search'

const buildTagRelationFilter = (
  tag: SearchSuggestionType
): PrismaType.patch_tag_relationWhereInput =>
  typeof tag.id === 'number'
    ? { tag_id: tag.id }
    : {
        tag: {
          OR: [{ name: tag.name }, { alias: { has: tag.name } }]
        }
      }

const buildCompanyRelationFilter = (
  company: SearchSuggestionType
): PrismaType.patch_company_relationWhereInput =>
  typeof company.id === 'number'
    ? { company_id: company.id }
    : {
        company: {
          OR: [
            { name: company.name },
            { alias: { has: company.name } },
            { parent_brand: { has: company.name } }
          ]
        }
      }

export const searchGalgame = async (
  input: z.infer<typeof searchSchema>,
  nsfwEnable: PrismaType.patchWhereInput
) => {
  const {
    queryString,
    limit,
    searchOption,
    page,
    selectedType = 'all',
    selectedLanguage = 'all',
    selectedPlatform = 'all',
    sortField,
    sortOrder,
    selectedYears = ['all'],
    selectedMonths = ['all'],
    minRatingCount
  } = input
  const offset = (page - 1) * limit
  const insensitive = Prisma.QueryMode.insensitive

  let query: SearchSuggestionType[]
  try {
    const parsedQuery = JSON.parse(queryString) as unknown
    if (!Array.isArray(parsedQuery)) {
      return '搜索条件格式错误'
    }
    query = parsedQuery.filter((item): item is SearchSuggestionType => {
      if (!item || typeof item !== 'object') {
        return false
      }
      const suggestion = item as Partial<SearchSuggestionType>
      return (
        (suggestion.type === 'keyword' ||
          suggestion.type === 'tag' ||
          suggestion.type === 'company') &&
        (suggestion.mode === 'include' || suggestion.mode === 'exclude') &&
        typeof suggestion.name === 'string' &&
        Boolean(suggestion.name.trim())
      )
    })
  } catch {
    return '搜索条件格式错误'
  }

  if (!query.length) {
    return '搜索条件为空'
  }

  const buildKeywordCondition = (
    keyword: string
  ): PrismaType.patchWhereInput => ({
    OR: [
      { name: { contains: keyword, mode: insensitive } },
      { vndb_id: keyword },
      { vndb_relation_id: keyword },
      { dlsite_code: keyword },
      ...(searchOption.searchInIntroduction
        ? [{ introduction: { contains: keyword, mode: insensitive } }]
        : []),
      ...(searchOption.searchInAlias
        ? [
            {
              alias: {
                some: {
                  name: { contains: keyword, mode: insensitive }
                }
              }
            }
          ]
        : []),
      ...(searchOption.searchInTag
        ? [
            {
              tag: {
                some: {
                  tag: { name: { contains: keyword, mode: insensitive } }
                }
              }
            }
          ]
        : [])
    ]
  })

  const buildKeywordExcludeCondition = (
    keyword: string
  ): PrismaType.patchWhereInput => ({
    AND: [
      {
        NOT: {
          name: { contains: keyword, mode: insensitive }
        }
      },
      { OR: [{ vndb_id: null }, { vndb_id: { not: keyword } }] },
      {
        OR: [{ vndb_relation_id: null }, { vndb_relation_id: { not: keyword } }]
      },
      { OR: [{ dlsite_code: null }, { dlsite_code: { not: keyword } }] },
      ...(searchOption.searchInIntroduction
        ? [
            {
              NOT: {
                introduction: { contains: keyword, mode: insensitive }
              }
            }
          ]
        : []),
      ...(searchOption.searchInAlias
        ? [
            {
              alias: {
                none: {
                  name: { contains: keyword, mode: insensitive }
                }
              }
            }
          ]
        : []),
      ...(searchOption.searchInTag
        ? [
            {
              tag: {
                none: {
                  tag: { name: { contains: keyword, mode: insensitive } }
                }
              }
            }
          ]
        : [])
    ]
  })

  const includedKeywords = query
    .filter((item) => item.type === 'keyword' && item.mode === 'include')
    .map((item) => item.name.trim())
    .filter(Boolean)
  const excludedKeywords = query
    .filter((item) => item.type === 'keyword' && item.mode === 'exclude')
    .map((item) => item.name.trim())
    .filter(Boolean)
  const includedTags = query.filter(
    (item) => item.type === 'tag' && item.mode === 'include'
  )
  const excludedTags = query.filter(
    (item) => item.type === 'tag' && item.mode === 'exclude'
  )
  const includedCompanies = query.filter(
    (item) => item.type === 'company' && item.mode === 'include'
  )
  const excludedCompanies = query.filter(
    (item) => item.type === 'company' && item.mode === 'exclude'
  )

  const dateFilter = buildGalgameDateFilter(selectedYears, selectedMonths)
  const where = buildGalgameWhere({
    selectedType,
    selectedLanguage,
    selectedPlatform,
    minRatingCount: sortField === 'rating' ? minRatingCount : 0,
    visibilityWhere: nsfwEnable
  })
  const orderBy = buildGalgameOrderBy(sortField, sortOrder)

  const queryCondition: PrismaType.patchWhereInput[] = [
    ...includedKeywords.map((keyword) => buildKeywordCondition(keyword)),

    nsfwEnable,

    ...includedTags.map((tag) => ({
      tag: { some: buildTagRelationFilter(tag) }
    })),
    ...includedCompanies.map((company) => ({
      company: { some: buildCompanyRelationFilter(company) }
    })),
    ...excludedKeywords.map((keyword) => buildKeywordExcludeCondition(keyword)),
    ...excludedTags.map((tag) => ({
      tag: { none: buildTagRelationFilter(tag) }
    })),
    ...excludedCompanies.map((company) => ({
      company: { none: buildCompanyRelationFilter(company) }
    }))
  ]

  const [data, total] = await Promise.all([
    prisma.patch.findMany({
      take: limit,
      skip: offset,
      orderBy,
      where: { AND: queryCondition, ...dateFilter, ...where },
      select: GalgameCardSelectField
    }),
    prisma.patch.count({
      where: { AND: queryCondition, ...dateFilter, ...where }
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

  return { galgames: await withRealtimePatchViews(galgames), total }
}

export const searchTag = async (input: z.infer<typeof searchTagSchema>) => {
  const { query } = input

  const [tags, companies] = await Promise.all([
    prisma.patch_tag.findMany({
      where: {
        OR: query.flatMap((q) => [
          { name: { contains: q, mode: 'insensitive' as const } },
          { alias: { has: q } }
        ])
      },
      select: {
        id: true,
        name: true,
        count: true
      },
      orderBy: { count: 'desc' },
      take: 50
    }),
    prisma.patch_company.findMany({
      where: {
        OR: query.flatMap((q) => [
          { name: { contains: q, mode: 'insensitive' as const } },
          { alias: { has: q } },
          { parent_brand: { has: q } }
        ])
      },
      select: {
        id: true,
        name: true,
        count: true
      },
      orderBy: { count: 'desc' },
      take: 50
    })
  ])

  const suggestions: SearchSuggestionType[] = [
    ...tags.map((tag) => ({
      id: tag.id,
      type: 'tag' as const,
      mode: 'include' as const,
      name: tag.name,
      count: tag.count
    })),
    ...companies.map((company) => ({
      id: company.id,
      type: 'company' as const,
      mode: 'include' as const,
      name: company.name,
      count: company.count
    }))
  ]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 100)
    .map(({ id, type, mode, name }) => ({ id, type, mode, name }))

  return suggestions
}
