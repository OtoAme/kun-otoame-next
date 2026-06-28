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
const deleteFileFromS3Mock = vi.hoisted(() => vi.fn())

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

vi.mock('~/app/api/patch/resource/_helper', () => ({
  extractS3Key: (url: string) =>
    url.startsWith('https://img.example/')
      ? url.slice('https://img.example/'.length)
      : null
}))

vi.mock('~/lib/s3', () => ({
  deleteFileFromS3: deleteFileFromS3Mock
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
    process.env.NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL =
      'https://img.example'
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
    deleteFileFromS3Mock.mockResolvedValue(undefined)
  })

  it('deletes S3 gallery objects when images are removed during rewrite', async () => {
    const input = createUpdateInput()
    input.galleryMetadata = JSON.stringify({
      keep: [],
      order: []
    })

    prismaMocks.patch_game_image.findMany.mockResolvedValue([
      {
        id: 10,
        url: 'https://img.example/patch/123/gallery/10.avif',
        thumbnail_url:
          'https://img.example/patch/123/gallery/thumbnail/thumb-10.avif',
        patch_id: 123
      },
      {
        id: 11,
        url: 'https://img.example/patch/123/gallery/11.webp',
        thumbnail_url: null,
        patch_id: 123
      }
    ])

    await expect(updateGalgame(input, 1)).resolves.toEqual({})

    expect(deleteFileFromS3Mock).toHaveBeenCalledWith(
      'patch/123/gallery/10.avif'
    )
    expect(deleteFileFromS3Mock).toHaveBeenCalledWith(
      'patch/123/gallery/thumbnail/thumb-10.avif'
    )
    expect(deleteFileFromS3Mock).toHaveBeenCalledWith(
      'patch/123/gallery/11.webp'
    )
    expect(deleteFileFromS3Mock).toHaveBeenCalledTimes(3)
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

  it('stores a Steam official URL when rewriting with Steam ID and blank official URL', async () => {
    await expect(
      updateGalgame(
        {
          ...createUpdateInput(),
          steamId: '3655150',
          officialUrl: ''
        },
        1
      )
    ).resolves.toEqual({})

    expect(prismaMocks.patch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 123 },
        data: expect.objectContaining({
          official_url: 'https://store.steampowered.com/app/3655150'
        })
      })
    )
  })

  it('preserves a manual official URL when rewriting with Steam ID', async () => {
    await expect(
      updateGalgame(
        {
          ...createUpdateInput(),
          steamId: '3655150',
          officialUrl: 'https://example.com/game'
        },
        1
      )
    ).resolves.toEqual({})

    expect(prismaMocks.patch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 123 },
        data: expect.objectContaining({
          official_url: 'https://example.com/game'
        })
      })
    )
  })
})
