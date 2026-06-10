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
})
