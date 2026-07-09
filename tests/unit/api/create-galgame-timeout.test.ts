import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => {
  const tx = {
    patch: {
      create: vi.fn(),
      update: vi.fn()
    },
    patch_rating_stat: {
      create: vi.fn()
    },
    user: {
      update: vi.fn()
    }
  }

  return {
    patch: {
      findFirst: vi.fn()
    },
    $transaction: vi.fn((fn: (transaction: typeof tx) => Promise<unknown>) =>
      fn(tx)
    ),
    _tx: tx
  }
})

vi.mock('~/prisma/index', () => ({
  prisma: prismaMocks
}))

const uploadPatchBannerMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/edit/_upload', () => ({
  uploadPatchBanner: uploadPatchBannerMock
}))

const processSubmittedExternalDataMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/edit/processExternalData', () => ({
  processSubmittedExternalData: processSubmittedExternalDataMock
}))

const invalidatePatchListCachesMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/patch/cache', () => ({
  invalidatePatchListCaches: invalidatePatchListCachesMock
}))

const postToIndexNowMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/edit/_postToIndexNow', () => ({
  postToIndexNow: postToIndexNowMock
}))

import { createGalgame } from '~/app/api/edit/create'

const createInput = {
  name: 'Large Banner Test',
  vndbId: '',
  vndbRelationId: '',
  bangumiId: '',
  steamId: '',
  dlsiteCode: '',
  dlsiteCircleName: '',
  dlsiteCircleLink: '',
  vndbTags: [],
  vndbDevelopers: [],
  bangumiTags: [],
  bangumiDevelopers: [],
  steamTags: [],
  steamDevelopers: [],
  steamAliases: [],
  alias: [],
  banner: new ArrayBuffer(8),
  tag: [],
  introduction: 'A valid introduction for timeout testing.',
  officialUrl: '',
  released: '2026-06-21',
  contentLimit: 'nsfw',
  isDuplicate: 'false'
}

describe('createGalgame timeout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMocks.patch.findFirst.mockResolvedValue(null)
    prismaMocks.$transaction.mockImplementation(
      (fn: (tx: typeof prismaMocks._tx) => Promise<unknown>) =>
        fn(prismaMocks._tx)
    )
    prismaMocks._tx.patch.create.mockResolvedValue({ id: 649 })
    prismaMocks._tx.patch.update.mockResolvedValue({})
    prismaMocks._tx.patch_rating_stat.create.mockResolvedValue({})
    prismaMocks._tx.user.update.mockResolvedValue({})
    uploadPatchBannerMock.mockResolvedValue(undefined)
    processSubmittedExternalDataMock.mockResolvedValue(undefined)
    invalidatePatchListCachesMock.mockResolvedValue(undefined)
    postToIndexNowMock.mockResolvedValue(undefined)
  })

  it('allows slow banner processing by using the create publish timeout', async () => {
    await createGalgame(createInput, 1)

    expect(prismaMocks.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { timeout: 120000 }
    )
  })

  it('stores a Steam official URL when creating with Steam ID and blank official URL', async () => {
    await createGalgame(
      {
        ...createInput,
        steamId: '3655150',
        officialUrl: ''
      },
      1
    )

    expect(prismaMocks._tx.patch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          official_url: 'https://store.steampowered.com/app/3655150'
        })
      })
    )
  })

  it('preserves a manual official URL when creating with Steam ID', async () => {
    await createGalgame(
      {
        ...createInput,
        steamId: '3655150',
        officialUrl: 'https://example.com/game'
      },
      1
    )

    expect(prismaMocks._tx.patch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          official_url: 'https://example.com/game'
        })
      })
    )
  })

  it('allows creating with a duplicate Steam ID', async () => {
    prismaMocks.patch.findFirst.mockImplementation(
      (args: { where: unknown }) => {
        const where = args.where as { steam_id?: number }
        if (where.steam_id === 3655150) {
          return Promise.resolve({ unique_id: 'steam123' })
        }
        return Promise.resolve(null)
      }
    )

    await expect(
      createGalgame(
        {
          ...createInput,
          steamId: '3655150'
        },
        1
      )
    ).resolves.toEqual({ uniqueId: expect.any(String), patchId: 649 })

    expect(prismaMocks.$transaction).toHaveBeenCalled()
    expect(prismaMocks._tx.patch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          steam_id: 3655150
        })
      })
    )
  })

  it('returns a user-visible error before creating with a duplicate Bangumi ID', async () => {
    prismaMocks.patch.findFirst.mockImplementation(
      (args: { where: unknown }) => {
        const where = args.where as { bangumi_id?: number }
        if (where.bangumi_id === 172612) {
          return Promise.resolve({ unique_id: 'bangumi1' })
        }
        return Promise.resolve(null)
      }
    )

    await expect(
      createGalgame(
        {
          ...createInput,
          bangumiId: '172612'
        },
        1
      )
    ).resolves.toBe('Bangumi ID 与游戏 ID 为 bangumi1 的游戏重复')

    expect(prismaMocks.$transaction).not.toHaveBeenCalled()
  })

  it('turns a Bangumi unique constraint race into a user-visible error', async () => {
    prismaMocks.patch.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ unique_id: 'bangumi1' })
    prismaMocks.$transaction.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['bangumi_id'] }
    })

    await expect(
      createGalgame(
        {
          ...createInput,
          bangumiId: '172612'
        },
        1
      )
    ).resolves.toBe('Bangumi ID 与游戏 ID 为 bangumi1 的游戏重复')
  })
})
