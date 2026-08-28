import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'
import type { Prisma } from '@prisma/client'
import type { searchSchema } from '~/validations/search'
import type { SearchSuggestionType } from '~/types/api/search'

const mocks = vi.hoisted(() => ({
  prisma: {
    patch: {
      findMany: vi.fn(),
      count: vi.fn()
    },
    patch_tag: {
      findMany: vi.fn()
    },
    patch_company: {
      findMany: vi.fn()
    }
  }
}))

vi.mock('~/prisma/index', () => ({
  prisma: mocks.prisma
}))

vi.mock('~/app/api/patch/views/realtime', () => ({
  withRealtimePatchViews: vi.fn(async (galgames: unknown[]) => galgames)
}))

import { searchGalgame, searchTag } from '~/app/api/search/service'

type SearchInput = z.infer<typeof searchSchema>

const visibilityWhere: Prisma.patchWhereInput = { content_limit: 'sfw' }

const baseInput: SearchInput = {
  queryString: '[]',
  limit: 12,
  searchOption: {
    searchInIntroduction: false,
    searchInAlias: false,
    searchInTag: false
  },
  page: 1,
  selectedType: 'all',
  selectedLanguage: 'all',
  selectedPlatform: 'all',
  sortField: 'resource_update_time',
  sortOrder: 'desc',
  selectedYears: ['all'],
  selectedMonths: ['all'],
  minRatingCount: 0
}

const runSearch = async (
  suggestions: SearchSuggestionType[],
  overrides: Partial<SearchInput> = {}
) => {
  const result = await searchGalgame(
    {
      ...baseInput,
      ...overrides,
      queryString: JSON.stringify(suggestions)
    },
    visibilityWhere
  )

  expect(typeof result).not.toBe('string')

  const where = mocks.prisma.patch.findMany.mock.calls[0][0]
    .where as Prisma.patchWhereInput
  return {
    where,
    and: (where.AND ?? []) as Prisma.patchWhereInput[]
  }
}

describe('searchGalgame suggestion conditions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.patch.findMany.mockResolvedValue([])
    mocks.prisma.patch.count.mockResolvedValue(0)
  })

  it('builds a positive OR condition for an included keyword', async () => {
    const { and } = await runSearch([
      { type: 'keyword', mode: 'include', name: 'moe' }
    ])

    expect(and).toContainEqual({
      OR: [
        { name: { contains: 'moe', mode: 'insensitive' } },
        { vndb_id: 'moe' },
        { vndb_relation_id: 'moe' },
        { dlsite_code: 'moe' }
      ]
    })
    expect(and).not.toContainEqual(
      expect.objectContaining({ AND: expect.any(Array) })
    )
  })

  it('builds a NOT condition for an excluded keyword and never an include one', async () => {
    const { and } = await runSearch([
      { type: 'keyword', mode: 'exclude', name: 'moe' }
    ])

    expect(and).toContainEqual({
      AND: [
        { NOT: { name: { contains: 'moe', mode: 'insensitive' } } },
        { OR: [{ vndb_id: null }, { vndb_id: { not: 'moe' } }] },
        {
          OR: [{ vndb_relation_id: null }, { vndb_relation_id: { not: 'moe' } }]
        },
        { OR: [{ dlsite_code: null }, { dlsite_code: { not: 'moe' } }] }
      ]
    })
    expect(and).not.toContainEqual(
      expect.objectContaining({
        OR: expect.arrayContaining([
          { name: { contains: 'moe', mode: 'insensitive' } }
        ])
      })
    )
  })

  it('honours the search options when excluding a keyword', async () => {
    const { and } = await runSearch(
      [{ type: 'keyword', mode: 'exclude', name: 'moe' }],
      {
        searchOption: {
          searchInIntroduction: true,
          searchInAlias: true,
          searchInTag: true
        }
      }
    )

    expect(and).toContainEqual(
      expect.objectContaining({
        AND: expect.arrayContaining([
          { NOT: { introduction: { contains: 'moe', mode: 'insensitive' } } },
          {
            alias: { none: { name: { contains: 'moe', mode: 'insensitive' } } }
          },
          {
            tag: {
              none: { tag: { name: { contains: 'moe', mode: 'insensitive' } } }
            }
          }
        ])
      })
    )
  })

  it('keeps included tags on some and excluded tags on none', async () => {
    const { and } = await runSearch([
      { type: 'tag', mode: 'include', id: 5, name: '纯爱' },
      { type: 'tag', mode: 'exclude', id: 6, name: '猎奇' },
      { type: 'tag', mode: 'exclude', name: '恐怖' }
    ])

    expect(and).toContainEqual({ tag: { some: { tag_id: 5 } } })
    expect(and).toContainEqual({ tag: { none: { tag_id: 6 } } })
    expect(and).toContainEqual({
      tag: {
        none: {
          tag: { OR: [{ name: '恐怖' }, { alias: { has: '恐怖' } }] }
        }
      }
    })
    expect(and).not.toContainEqual({ tag: { some: { tag_id: 6 } } })
  })

  it('filters included companies by company_id when the suggestion carries an id', async () => {
    const { and } = await runSearch([
      { type: 'company', mode: 'include', id: 3, name: 'Otomate' }
    ])

    expect(and).toContainEqual({ company: { some: { company_id: 3 } } })
  })

  it('filters included companies by name, alias and parent brand without an id', async () => {
    const { and } = await runSearch([
      { type: 'company', mode: 'include', name: 'Otomate' }
    ])

    expect(and).toContainEqual({
      company: {
        some: {
          company: {
            OR: [
              { name: 'Otomate' },
              { alias: { has: 'Otomate' } },
              { parent_brand: { has: 'Otomate' } }
            ]
          }
        }
      }
    })
  })

  it('excludes companies through the none form', async () => {
    const { and } = await runSearch([
      { type: 'company', mode: 'exclude', id: 3, name: 'Otomate' },
      { type: 'company', mode: 'exclude', name: 'Rejet' }
    ])

    expect(and).toContainEqual({ company: { none: { company_id: 3 } } })
    expect(and).toContainEqual({
      company: {
        none: {
          company: {
            OR: [
              { name: 'Rejet' },
              { alias: { has: 'Rejet' } },
              { parent_brand: { has: 'Rejet' } }
            ]
          }
        }
      }
    })
    expect(and).not.toContainEqual({ company: { some: { company_id: 3 } } })
  })

  it('keeps the visibility filter in both the where object and the AND list', async () => {
    const { where, and } = await runSearch([
      { type: 'keyword', mode: 'include', name: 'moe' }
    ])

    expect(where).toMatchObject({ content_limit: 'sfw' })
    expect(and).toContainEqual({ content_limit: 'sfw' })
  })

  it('applies minRatingCount only when sorting by rating', async () => {
    const rating = await runSearch(
      [{ type: 'keyword', mode: 'include', name: 'moe' }],
      { sortField: 'rating', minRatingCount: 8 }
    )
    expect(rating.where.rating_stat).toEqual({ count: { gte: 8 } })

    vi.clearAllMocks()
    mocks.prisma.patch.findMany.mockResolvedValue([])
    mocks.prisma.patch.count.mockResolvedValue(0)

    const created = await runSearch(
      [{ type: 'keyword', mode: 'include', name: 'moe' }],
      { sortField: 'created', minRatingCount: 8 }
    )
    expect(created.where.rating_stat).toBeUndefined()
  })

  it('does not apply a rating_stat filter when minRatingCount is zero', async () => {
    const { where } = await runSearch(
      [{ type: 'keyword', mode: 'include', name: 'moe' }],
      { sortField: 'rating', minRatingCount: 0 }
    )

    expect(where.rating_stat).toBeUndefined()
  })

  it('rejects a malformed query string before touching the database', async () => {
    await expect(
      searchGalgame({ ...baseInput, queryString: 'not json' }, visibilityWhere)
    ).resolves.toBe('搜索条件格式错误')
    await expect(
      searchGalgame({ ...baseInput, queryString: '{"a":1}' }, visibilityWhere)
    ).resolves.toBe('搜索条件格式错误')
    expect(mocks.prisma.patch.findMany).not.toHaveBeenCalled()
  })

  it('rejects an empty or fully invalid suggestion list', async () => {
    await expect(
      searchGalgame({ ...baseInput, queryString: '[]' }, visibilityWhere)
    ).resolves.toBe('搜索条件为空')
    await expect(
      searchGalgame(
        {
          ...baseInput,
          queryString: JSON.stringify([{ type: 'unknown', name: 'moe' }])
        },
        visibilityWhere
      )
    ).resolves.toBe('搜索条件为空')
    expect(mocks.prisma.patch.findMany).not.toHaveBeenCalled()
  })
})

describe('searchTag suggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.patch_tag.findMany.mockResolvedValue([])
    mocks.prisma.patch_company.findMany.mockResolvedValue([])
  })

  it('merges tag and company suggestions sorted by count', async () => {
    mocks.prisma.patch_tag.findMany.mockResolvedValue([
      { id: 1, name: '纯爱', count: 5 },
      { id: 2, name: '校园', count: 20 }
    ])
    mocks.prisma.patch_company.findMany.mockResolvedValue([
      { id: 7, name: 'Otomate', count: 12 }
    ])

    const suggestions = await searchTag({ query: ['o'] })

    expect(suggestions).toEqual([
      { id: 2, type: 'tag', mode: 'include', name: '校园' },
      { id: 7, type: 'company', mode: 'include', name: 'Otomate' },
      { id: 1, type: 'tag', mode: 'include', name: '纯爱' }
    ])
    expect(suggestions[0]).not.toHaveProperty('count')
  })

  it('queries company name, alias and parent brand', async () => {
    await searchTag({ query: ['otomate'] })

    expect(mocks.prisma.patch_company.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { name: { contains: 'otomate', mode: 'insensitive' } },
            { alias: { has: 'otomate' } },
            { parent_brand: { has: 'otomate' } }
          ]
        }
      })
    )
    expect(mocks.prisma.patch_tag.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { name: { contains: 'otomate', mode: 'insensitive' } },
            { alias: { has: 'otomate' } }
          ]
        }
      })
    )
  })

  it('breaks count ties by name', async () => {
    mocks.prisma.patch_tag.findMany.mockResolvedValue([
      { id: 1, name: 'beta', count: 4 }
    ])
    mocks.prisma.patch_company.findMany.mockResolvedValue([
      { id: 2, name: 'alpha', count: 4 }
    ])

    const suggestions = await searchTag({ query: ['a'] })

    expect(suggestions.map((item) => item.name)).toEqual(['alpha', 'beta'])
  })
})
