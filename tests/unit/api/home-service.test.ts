import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getOrSet: vi.fn(async (_key: string, producer: () => Promise<unknown>) =>
    producer()
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

  it('keeps the static home payload compact', async () => {
    await getHomeData({ content_limit: 'sfw' })

    expect(mocks.prisma.patch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 12
      })
    )
    expect(mocks.prisma.patch_resource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 4
      })
    )
  })

  it('includes payload shape in the Redis key', async () => {
    await getHomeData({ content_limit: 'sfw' })

    expect(mocks.getOrSet).toHaveBeenCalledWith(
      expect.stringMatching(/^home_data:v2:g12:r4:/),
      expect.any(Function),
      expect.any(Number)
    )
  })
})
