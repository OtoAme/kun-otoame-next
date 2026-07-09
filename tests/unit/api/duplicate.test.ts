import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => ({
  patch: {
    findFirst: vi.fn(),
    findMany: vi.fn()
  }
}))

vi.mock('~/prisma/index', () => ({
  prisma: prismaMocks
}))

import { duplicate } from '~/app/api/edit/duplicate/service'

describe('edit duplicate service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMocks.patch.findFirst.mockResolvedValue(null)
    prismaMocks.patch.findMany.mockResolvedValue([])
  })

  it('excludes the current patch when checking rewrite duplicates', async () => {
    prismaMocks.patch.findMany.mockResolvedValue([])

    const result = await duplicate({
      vndbId: 'v123',
      excludeId: '10'
    })

    expect(result).toEqual({})
    expect(prismaMocks.patch.findMany).toHaveBeenCalledWith({
      where: { vndb_id: 'v123', id: { not: 10 } },
      select: { unique_id: true, name: true },
      take: 20
    })
  })

  it('checks Steam ID duplicates', async () => {
    prismaMocks.patch.findFirst.mockResolvedValue({
      unique_id: 'steam123',
      name: 'Steam Duplicate'
    })

    const result = await duplicate({
      steamId: '3655150'
    })

    expect(result).toEqual({
      uniqueId: 'steam123',
      matchedFields: ['steamId'],
      duplicates: [{ uniqueId: 'steam123', name: 'Steam Duplicate' }]
    })
    expect(prismaMocks.patch.findFirst).toHaveBeenCalledWith({
      where: { steam_id: 3655150 },
      select: { unique_id: true, name: true }
    })
  })

  it('checks Bangumi ID duplicates', async () => {
    prismaMocks.patch.findFirst.mockResolvedValue({
      unique_id: 'bangumi1',
      name: 'Bangumi Duplicate'
    })

    const result = await duplicate({
      bangumiId: '172612'
    })

    expect(result).toEqual({
      uniqueId: 'bangumi1',
      matchedFields: ['bangumiId'],
      duplicates: [{ uniqueId: 'bangumi1', name: 'Bangumi Duplicate' }]
    })
    expect(prismaMocks.patch.findFirst).toHaveBeenCalledWith({
      where: { bangumi_id: 172612 },
      select: { unique_id: true, name: true }
    })
  })
})
