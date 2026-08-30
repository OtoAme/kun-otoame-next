import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
const invalidateCompanyCachesMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/patch/cache', () => ({
  invalidatePatchListCaches: invalidatePatchListCachesMock,
  invalidateCompanyCaches: invalidateCompanyCachesMock
}))

const earnMoemoepointMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/moemoepoint/service', () => ({
  earnMoemoepoint: earnMoemoepointMock
}))

const postToIndexNowMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/edit/_postToIndexNow', () => ({
  postToIndexNow: postToIndexNowMock
}))

import { createGalgame } from '~/app/api/edit/create'
import { CompanyResolutionAmbiguityError } from '~/app/api/company/identity/resolver'

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
    earnMoemoepointMock.mockResolvedValue({
      balance: { total: 3, reserved: 0, available: 3 },
      ledgerId: 1,
      applied: true
    })
    uploadPatchBannerMock.mockResolvedValue(undefined)
    processSubmittedExternalDataMock.mockResolvedValue({
      companyRelationsChanged: false
    })
    invalidatePatchListCachesMock.mockResolvedValue(undefined)
    invalidateCompanyCachesMock.mockResolvedValue(undefined)
    postToIndexNowMock.mockResolvedValue(undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
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
    ).resolves.toEqual({
      uniqueId: expect.any(String),
      patchId: 649,
      moemoepointBalance: { total: 3, reserved: 0, available: 3 },
      warnings: []
    })

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

  it('returns the committed patch and original reward balance when company resolution is ambiguous', async () => {
    processSubmittedExternalDataMock.mockRejectedValue(
      new CompanyResolutionAmbiguityError([])
    )

    await expect(
      createGalgame({ ...createInput, contentLimit: 'sfw' }, 1)
    ).resolves.toEqual({
      uniqueId: expect.any(String),
      patchId: 649,
      moemoepointBalance: { total: 3, reserved: 0, available: 3 },
      warnings: [
        {
          kind: 'company-ambiguity',
          message: '游戏内容已保存，但部分会社需要管理员维护。'
        }
      ]
    })

    expect(prismaMocks.$transaction).toHaveBeenCalledOnce()
    expect(earnMoemoepointMock).toHaveBeenCalledOnce()
    expect(invalidatePatchListCachesMock).toHaveBeenCalledOnce()
    expect(invalidateCompanyCachesMock).toHaveBeenCalledOnce()
    expect(postToIndexNowMock).toHaveBeenCalledOnce()
  })

  it('returns a safe warning when external enrichment fails unexpectedly', async () => {
    processSubmittedExternalDataMock.mockRejectedValue(
      new Error('internal database detail')
    )

    await expect(createGalgame(createInput, 1)).resolves.toEqual(
      expect.objectContaining({
        patchId: 649,
        moemoepointBalance: { total: 3, reserved: 0, available: 3 },
        warnings: [
          {
            kind: 'external-data-error',
            message: '游戏内容已保存，但部分外部数据未能完成处理，请稍后检查。'
          }
        ]
      })
    )

    expect(console.error).toHaveBeenCalledWith(
      'Failed to process external data after creating a patch',
      expect.objectContaining({ patchId: 649, error: expect.any(Error) })
    )
    expect(invalidatePatchListCachesMock).toHaveBeenCalledOnce()
  })

  it('keeps the committed result when cache invalidation and IndexNow fail', async () => {
    invalidatePatchListCachesMock.mockRejectedValue(new Error('cache failed'))
    postToIndexNowMock.mockRejectedValue(new Error('index failed'))

    await expect(
      createGalgame({ ...createInput, contentLimit: 'sfw' }, 1)
    ).resolves.toEqual(
      expect.objectContaining({
        patchId: 649,
        moemoepointBalance: { total: 3, reserved: 0, available: 3 },
        warnings: []
      })
    )

    expect(invalidatePatchListCachesMock).toHaveBeenCalledOnce()
    expect(postToIndexNowMock).toHaveBeenCalledOnce()
  })

  it('does not turn company cache failure into an external-data warning', async () => {
    processSubmittedExternalDataMock.mockResolvedValue({
      companyRelationsChanged: true
    })
    invalidateCompanyCachesMock.mockRejectedValue(
      new Error('company cache failed')
    )

    await expect(createGalgame(createInput, 1)).resolves.toEqual(
      expect.objectContaining({
        patchId: 649,
        warnings: []
      })
    )

    expect(invalidateCompanyCachesMock).toHaveBeenCalledOnce()
  })
})
