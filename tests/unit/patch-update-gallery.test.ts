import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => {
  const tx = {
    patch_alias: {
      deleteMany: vi.fn(),
      createMany: vi.fn()
    }
  }

  return {
    patch: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn()
    },
    patch_alias: tx.patch_alias,
    patch_game_image: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn()
    },
    $transaction: vi.fn((fn) => fn(tx))
  }
})
const invalidatePatchContentCacheMock = vi.hoisted(() => vi.fn())
const invalidatePatchListCachesMock = vi.hoisted(() => vi.fn())
const processSubmittedExternalDataMock = vi.hoisted(() => vi.fn())

vi.mock('~/prisma/index', () => ({
  prisma: prismaMocks
}))

vi.mock('~/app/api/patch/cache', () => ({
  invalidatePatchContentCache: invalidatePatchContentCacheMock,
  invalidatePatchListCaches: invalidatePatchListCachesMock
}))

vi.mock('~/app/api/utils/purgeCache', () => ({
  purgePatchBannerCache: vi.fn()
}))

vi.mock('~/app/api/edit/processExternalData', () => ({
  processSubmittedExternalData: processSubmittedExternalDataMock
}))

vi.mock('~/app/api/edit/_upload', () => ({
  uploadPatchBanner: vi.fn()
}))

import { updateGalgame } from '~/app/api/edit/update'

const createUpdateInput = () => ({
  id: 123,
  name: 'Updated title',
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
  introduction: 'Updated introduction text',
  officialUrl: '',
  tag: [],
  alias: [],
  contentLimit: 'sfw',
  released: '',
  isDuplicate: 'false',
  galleryMetadata: JSON.stringify({
    keep: [{ id: 10, is_nsfw: true }],
    order: [10]
  })
})

describe('patch update gallery metadata', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    prismaMocks.patch.findUnique.mockResolvedValue({
      id: 123,
      unique_id: 'patch-unique'
    })
    prismaMocks.patch.findFirst.mockResolvedValue(null)
    prismaMocks.patch.update.mockResolvedValue({})
    prismaMocks.patch_alias.deleteMany.mockResolvedValue({})
    prismaMocks.patch_alias.createMany.mockResolvedValue({})
    prismaMocks.patch_game_image.findMany.mockResolvedValue([
      {
        id: 10,
        url: 'https://img.example/patch/123/gallery/10.webp',
        thumbnail_url:
          'https://img.example/patch/123/gallery/thumbnail/10.webp',
        patch_id: 123
      }
    ])
    prismaMocks.patch_game_image.deleteMany.mockResolvedValue({})
    prismaMocks.patch_game_image.update.mockResolvedValue({})
    invalidatePatchContentCacheMock.mockResolvedValue(undefined)
    invalidatePatchListCachesMock.mockResolvedValue(undefined)
    processSubmittedExternalDataMock.mockResolvedValue(undefined)
  })

  it('updates existing gallery state without writing original or thumbnail URLs', async () => {
    await expect(updateGalgame(createUpdateInput(), 1)).resolves.toEqual({})

    expect(prismaMocks.patch_game_image.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: {
        is_nsfw: true,
        display_order: 0
      }
    })
    expect(prismaMocks.patch_game_image.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          url: expect.anything()
        })
      })
    )
    expect(prismaMocks.patch_game_image.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          thumbnail_url: expect.anything()
        })
      })
    )
  })
})
