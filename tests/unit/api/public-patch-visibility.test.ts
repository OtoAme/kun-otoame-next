import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getOrSet: vi.fn(async (_key: string, producer: () => Promise<unknown>) =>
    producer()
  ),
  getKv: vi.fn(),
  setKv: vi.fn(),
  prisma: {
    patch: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn()
    },
    patch_resource: {
      findMany: vi.fn()
    },
    patch_rating_stat: {
      findUnique: vi.fn()
    }
  }
}))

vi.mock('~/prisma/index', () => ({
  prisma: mocks.prisma
}))

vi.mock('~/prisma', () => ({
  prisma: mocks.prisma
}))

vi.mock('~/lib/redis', () => ({
  getOrSet: mocks.getOrSet,
  getKv: mocks.getKv,
  setKv: mocks.setKv
}))

vi.mock('~/app/api/patch/views/realtime', () => ({
  withRealtimePatchViews: vi.fn(async (galgames: unknown[]) => galgames),
  withRealtimePatchView: vi.fn(async (patch: unknown) => patch)
}))

vi.mock('~/app/api/patch/cache', async () => {
  const actual = await vi.importActual<typeof import('~/app/api/patch/cache')>(
    '~/app/api/patch/cache'
  )
  return {
    ...actual,
    getCachedPatchFavoriteStatus: vi.fn(),
    setCachedPatchFavoriteStatus: vi.fn()
  }
})

const listInput = {
  selectedType: 'all',
  selectedLanguage: 'all',
  selectedPlatform: 'all',
  sortField: 'created' as const,
  sortOrder: 'desc' as const,
  page: 1,
  limit: 24,
  yearString: JSON.stringify(['all']),
  monthString: JSON.stringify(['all']),
  minRatingCount: 0
}

describe('public patch visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.patch.findMany.mockResolvedValue([])
    mocks.prisma.patch.count.mockResolvedValue(0)
    mocks.prisma.patch_resource.findMany.mockResolvedValue([])
    mocks.prisma.patch.findUnique.mockResolvedValue(null)
    mocks.prisma.patch.findFirst.mockResolvedValue(null)
    mocks.prisma.patch_rating_stat.findUnique.mockResolvedValue(null)
    mocks.getKv.mockResolvedValue(null)
  })

  it('home queries only visible patches', async () => {
    const { getHomeData } = await import('~/app/api/home/service')

    await getHomeData({ content_limit: 'sfw' })

    expect(mocks.prisma.patch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          content_limit: 'sfw',
          status: 0
        })
      })
    )
    expect(mocks.prisma.patch_resource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patch: expect.objectContaining({
            content_limit: 'sfw',
            status: 0
          })
        })
      })
    )
  })

  it('otomegame list queries and counts only visible patches', async () => {
    const { getGalgame } = await import('~/app/api/otomegame/service')

    await getGalgame(listInput, { content_limit: 'sfw' })

    expect(mocks.prisma.patch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          content_limit: 'sfw',
          status: 0
        })
      })
    )
    expect(mocks.prisma.patch.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        content_limit: 'sfw',
        status: 0
      })
    })
  })

  it('tag and company game lists include visible status', async () => {
    const { getPatchByTag } = await import('~/app/api/tag/service')
    const { getPatchByCompany } = await import('~/app/api/company/service')

    await getPatchByTag({ ...listInput, tagId: 15 }, { content_limit: 'sfw' })
    await getPatchByCompany(
      { ...listInput, companyId: 4 },
      { content_limit: 'sfw' }
    )

    expect(mocks.prisma.patch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 0,
          tag: expect.any(Object)
        })
      })
    )
    expect(mocks.prisma.patch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 0,
          company: expect.any(Object)
        })
      })
    )
  })

  it('search and ranking only read visible patches', async () => {
    const { searchGalgame } = await import('~/app/api/search/service')
    const { getRanking } = await import('~/app/api/ranking/service')

    await searchGalgame(
      {
        queryString: JSON.stringify([
          { type: 'keyword', mode: 'include', name: 'test' }
        ]),
        searchOption: {
          searchInIntroduction: false,
          searchInAlias: false,
          searchInTag: false
        },
        selectedType: 'all',
        selectedLanguage: 'all',
        selectedPlatform: 'all',
        sortField: 'created',
        sortOrder: 'desc',
        page: 1,
        limit: 24,
        selectedYears: ['all'],
        selectedMonths: ['all'],
        minRatingCount: 0
      },
      { content_limit: 'sfw' }
    )
    await getRanking(
      {
        sortField: 'view',
        sortOrder: 'desc',
        minRatingCount: 0,
        page: 1,
        limit: 24
      },
      { content_limit: 'sfw' }
    )

    expect(mocks.prisma.patch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 0
        })
      })
    )
    expect(mocks.prisma.patch.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 0
        })
      })
    )
  })

  it('patch detail lookup ignores hidden patches', async () => {
    const { getPatchById } = await import('~/app/api/patch/get')

    await getPatchById({ uniqueId: '12345678' }, 0)

    expect(mocks.prisma.patch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          unique_id: '12345678',
          status: 0
        }
      })
    )
    expect(mocks.prisma.patch.findUnique).not.toHaveBeenCalled()
  })
})
