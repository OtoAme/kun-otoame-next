import { describe, expect, it } from 'vitest'
import { getGalgameListQuery, readGalgameFilters } from '~/utils/galgameFilter'

describe('galgame URL filters', () => {
  it('uses the correct defaults for games and tag/company lists', () => {
    expect(readGalgameFilters(new URLSearchParams(), 10).minRatingCount).toBe(
      10
    )
    expect(readGalgameFilters(new URLSearchParams()).minRatingCount).toBe(0)
    expect(
      getGalgameListQuery(readGalgameFilters(new URLSearchParams(), 10))
    ).toMatchObject({
      page: 1,
      sortField: 'resource_update_time',
      minRatingCount: 0
    })
  })

  it('restores pagination, rating and release filters from the URL', () => {
    const filters = readGalgameFilters(
      new URLSearchParams({
        page: '3',
        sortField: 'rating',
        sortOrder: 'asc',
        minRatingCount: '5',
        yearString: '["2025"]',
        monthString: '["02"]'
      })
    )
    expect(getGalgameListQuery(filters)).toMatchObject({
      page: 3,
      sortField: 'rating',
      sortOrder: 'asc',
      minRatingCount: 5,
      yearString: '["2025"]',
      monthString: '["02"]'
    })
  })

  it('normalizes invalid sorting, page and release inputs to valid defaults', () => {
    const filters = readGalgameFilters(
      new URLSearchParams({
        page: '-1',
        sortField: 'invalid',
        sortOrder: 'invalid',
        yearString: '{}',
        monthString: 'broken'
      })
    )
    expect(getGalgameListQuery(filters)).toMatchObject({
      page: 1,
      sortField: 'resource_update_time',
      sortOrder: 'desc',
      yearString: '["all"]',
      monthString: '["all"]'
    })
  })
})
