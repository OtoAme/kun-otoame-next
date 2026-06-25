import { beforeEach, describe, expect, it, vi } from 'vitest'

const deleteFileFromS3Mock = vi.hoisted(() => vi.fn())
const invalidatePatchContentCacheMock = vi.hoisted(() => vi.fn())
const invalidatePatchListCachesMock = vi.hoisted(() => vi.fn())

vi.mock('~/lib/s3', () => ({
  deleteFileFromS3: deleteFileFromS3Mock,
  uploadFileToS3: vi.fn(),
  uploadImageToS3: vi.fn(),
  cleanupLocalUpload: vi.fn()
}))

vi.mock('~/app/api/patch/cache', () => ({
  invalidatePatchContentCache: invalidatePatchContentCacheMock,
  invalidatePatchListCaches: invalidatePatchListCachesMock
}))

vi.mock('~/lib/redis', () => ({
  consumeUpload: vi.fn(),
  finalizeUpload: vi.fn(),
  releaseUploadConsumeLock: vi.fn()
}))

const prismaMocks = vi.hoisted(() => {
  const tx = {
    patch_resource: { delete: vi.fn() },
    patch: { delete: vi.fn() }
  }

  return {
    patch: { findUnique: vi.fn() },
    patch_resource: { findMany: vi.fn() },
    patch_game_image: { findMany: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(async (fn) => fn(tx))
  }
})

vi.mock('~/prisma/index', () => ({ prisma: prismaMocks }))

import { deletePatchById } from '~/app/api/patch/delete'

describe('patch delete with gallery S3 cleanup', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env.NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL = 'https://img.example'
    invalidatePatchContentCacheMock.mockResolvedValue(undefined)
    invalidatePatchListCachesMock.mockResolvedValue(undefined)
    deleteFileFromS3Mock.mockResolvedValue(undefined)
  })

  it('deletes gallery S3 objects when deleting an entire patch', async () => {
    prismaMocks.patch.findUnique.mockResolvedValue({
      id: 123,
      unique_id: 'patch-unique'
    })
    prismaMocks.patch_resource.findMany.mockResolvedValue([])
    prismaMocks.patch_game_image.findMany.mockResolvedValue([
      {
        id: 10,
        url: 'https://img.example/patch/123/gallery/10.avif',
        thumbnail_url: 'https://img.example/patch/123/gallery/thumbnail/thumb-10.avif'
      },
      {
        id: 11,
        url: 'https://img.example/patch/123/gallery/11.webp',
        thumbnail_url: null
      }
    ])

    await expect(deletePatchById({ patchId: 123 })).resolves.toEqual({})

    expect(deleteFileFromS3Mock).toHaveBeenCalledWith('patch/123/gallery/10.avif')
    expect(deleteFileFromS3Mock).toHaveBeenCalledWith('patch/123/gallery/thumbnail/thumb-10.avif')
    expect(deleteFileFromS3Mock).toHaveBeenCalledWith('patch/123/gallery/11.webp')
    expect(deleteFileFromS3Mock).toHaveBeenCalledTimes(3)
    expect(invalidatePatchContentCacheMock).toHaveBeenCalledWith('patch-unique')
    expect(invalidatePatchListCachesMock).toHaveBeenCalled()
  })

  it('still completes patch deletion when gallery S3 delete fails', async () => {
    prismaMocks.patch.findUnique.mockResolvedValue({
      id: 123,
      unique_id: 'patch-unique'
    })
    prismaMocks.patch_resource.findMany.mockResolvedValue([])
    prismaMocks.patch_game_image.findMany.mockResolvedValue([
      {
        id: 10,
        url: 'https://img.example/patch/123/gallery/10.avif',
        thumbnail_url: null
      }
    ])
    deleteFileFromS3Mock.mockRejectedValue(new Error('S3 error'))

    await expect(deletePatchById({ patchId: 123 })).resolves.toEqual({})

    expect(deleteFileFromS3Mock).toHaveBeenCalled()
    expect(invalidatePatchContentCacheMock).toHaveBeenCalledWith('patch-unique')
  })

  it('handles patch with no gallery images', async () => {
    prismaMocks.patch.findUnique.mockResolvedValue({
      id: 123,
      unique_id: 'patch-unique'
    })
    prismaMocks.patch_resource.findMany.mockResolvedValue([])
    prismaMocks.patch_game_image.findMany.mockResolvedValue([])

    await expect(deletePatchById({ patchId: 123 })).resolves.toEqual({})

    expect(deleteFileFromS3Mock).not.toHaveBeenCalled()
    expect(invalidatePatchContentCacheMock).toHaveBeenCalledWith('patch-unique')
  })
})
