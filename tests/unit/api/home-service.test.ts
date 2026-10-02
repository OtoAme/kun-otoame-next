import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getOrSet: vi.fn(
    async (
      _key: string,
      producer: () => Promise<unknown>,
      _ttl: number,
      _options?: unknown
    ) => producer()
  ),
  prisma: {
    patch: {
      findMany: vi.fn()
    },
    patch_resource: {
      findMany: vi.fn()
    }
  }
}))

vi.mock('~/prisma/index', () => ({
  prisma: mocks.prisma
}))

vi.mock('~/lib/redis', () => ({
  getOrSet: mocks.getOrSet
}))

vi.mock('~/app/api/patch/views/realtime', () => ({
  withRealtimePatchViews: vi.fn(async (galgames: unknown[]) => galgames)
}))

import { getHomeData } from '~/app/api/home/service'

describe('getHomeData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.patch.findMany.mockResolvedValue([])
    mocks.prisma.patch_resource.findMany.mockResolvedValue([])
  })

  it('fetches 24 latest games for six desktop rows', async () => {
    await getHomeData({ content_limit: 'sfw' })

    expect(mocks.prisma.patch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { created: 'desc' },
        take: 24
      })
    )
    expect(mocks.prisma.patch_resource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 4
      })
    )
  })

  it('uses a cache key for the 24-game home payload', async () => {
    await getHomeData({ content_limit: 'sfw' })

    expect(mocks.getOrSet).toHaveBeenCalledWith(
      expect.stringMatching(/^home_data:v2:g24:r4:/),
      expect.any(Function),
      expect.any(Number),
      expect.any(Object)
    )
  })

  it('does not consider an empty game list cacheable for home data', async () => {
    await getHomeData({ content_limit: 'sfw' })

    const options = mocks.getOrSet.mock.calls[0][3] as {
      shouldCacheValue: (value: {
        galgames: GalgameCard[]
        resources: unknown[]
      }) => boolean
      isCachedValueValid: (value: {
        galgames: GalgameCard[]
        resources: unknown[]
      }) => boolean
    }

    expect(
      options.shouldCacheValue({
        galgames: [],
        resources: [{ id: 1 }]
      })
    ).toBe(false)
    expect(
      options.isCachedValueValid({
        galgames: [],
        resources: []
      })
    ).toBe(false)
    expect(
      options.shouldCacheValue({
        galgames: [{} as GalgameCard],
        resources: []
      })
    ).toBe(true)
  })
})
