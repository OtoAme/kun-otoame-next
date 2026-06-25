import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => ({
  patch: {
    findUnique: vi.fn()
  },
  patch_game_image: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
  }
}))
const verifyHeaderCookieMock = vi.hoisted(() => vi.fn())
const invalidatePatchContentCacheMock = vi.hoisted(() => vi.fn())
const uploadPatchGalleryImageMock = vi.hoisted(() => vi.fn())
const deleteFileFromS3Mock = vi.hoisted(() => vi.fn())

vi.mock('~/prisma/index', () => ({
  prisma: prismaMocks
}))

vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: verifyHeaderCookieMock
}))

vi.mock('~/app/api/patch/cache', () => ({
  invalidatePatchContentCache: invalidatePatchContentCacheMock
}))

vi.mock('~/lib/s3', () => ({
  deleteFileFromS3: deleteFileFromS3Mock
}))

vi.mock('~/app/api/edit/galleryUpload', () => ({
  uploadPatchGalleryImage: uploadPatchGalleryImageMock
}))

import { POST } from '~/app/api/edit/gallery/route'

const createGalleryRequest = () => {
  const formData = new FormData()
  formData.append('patchId', '123')
  formData.append('image', new File([Buffer.from('image')], 'image.webp'))
  formData.append('isNSFW', 'true')
  formData.append('watermark', 'true')
  formData.append('displayOrder', '2')

  return {
    formData: vi.fn().mockResolvedValue(formData)
  } as any
}

describe('gallery upload route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL = 'https://img.example'
    verifyHeaderCookieMock.mockResolvedValue({ uid: 1, role: 3 })
    prismaMocks.patch.findUnique.mockResolvedValue({
      id: 123,
      unique_id: 'patch-unique'
    })
    prismaMocks.patch_game_image.create.mockResolvedValue({ id: 456 })
    prismaMocks.patch_game_image.update.mockResolvedValue({})
    prismaMocks.patch_game_image.delete.mockResolvedValue({})
    invalidatePatchContentCacheMock.mockResolvedValue(undefined)
    deleteFileFromS3Mock.mockResolvedValue(undefined)
    uploadPatchGalleryImageMock.mockResolvedValue({
      extension: 'webp',
      contentType: 'image/webp',
      thumbnailExtension: 'webp',
      thumbnailContentType: 'image/webp',
      skipWatermark: true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes and returns original and thumbnail URLs', async () => {
    const response = await POST(createGalleryRequest())

    await expect(response.json()).resolves.toEqual({
      imageId: 456,
      url: 'https://img.example/patch/123/gallery/456.webp',
      thumbnailUrl: 'https://img.example/patch/123/gallery/thumbnail/456.webp'
    })
    expect(prismaMocks.patch_game_image.update).toHaveBeenCalledWith({
      where: { id: 456 },
      data: {
        url: 'https://img.example/patch/123/gallery/456.webp',
        thumbnail_url:
          'https://img.example/patch/123/gallery/thumbnail/456.webp'
      }
    })
    expect(invalidatePatchContentCacheMock).toHaveBeenCalledWith(
      'patch-unique'
    )
  })

  it('deletes uploaded original and thumbnail objects when DB URL update fails', async () => {
    prismaMocks.patch_game_image.update.mockRejectedValue(
      new Error('database failed')
    )

    const response = await POST(createGalleryRequest())

    await expect(response.json()).resolves.toBe('图片上传失败')
    expect(deleteFileFromS3Mock).toHaveBeenCalledWith(
      'patch/123/gallery/456.webp'
    )
    expect(deleteFileFromS3Mock).toHaveBeenCalledWith(
      'patch/123/gallery/thumbnail/456.webp'
    )
    expect(prismaMocks.patch_game_image.delete).toHaveBeenCalledWith({
      where: { id: 456 }
    })
  })

  it('writes null thumbnail URL when upload returns no thumbnail', async () => {
    uploadPatchGalleryImageMock.mockResolvedValue({
      extension: 'avif',
      contentType: 'image/avif',
      skipWatermark: true
    })

    const response = await POST(createGalleryRequest())

    await expect(response.json()).resolves.toEqual({
      imageId: 456,
      url: 'https://img.example/patch/123/gallery/456.avif',
      thumbnailUrl: null
    })
    expect(prismaMocks.patch_game_image.update).toHaveBeenCalledWith({
      where: { id: 456 },
      data: {
        url: 'https://img.example/patch/123/gallery/456.avif',
        thumbnail_url: null
      }
    })
  })

  it('does not delete a thumbnail object that was never uploaded', async () => {
    uploadPatchGalleryImageMock.mockResolvedValue({
      extension: 'avif',
      contentType: 'image/avif',
      skipWatermark: true
    })
    prismaMocks.patch_game_image.update.mockRejectedValue(
      new Error('database failed')
    )

    const response = await POST(createGalleryRequest())

    await expect(response.json()).resolves.toBe('图片上传失败')
    expect(deleteFileFromS3Mock).toHaveBeenCalledTimes(1)
    expect(deleteFileFromS3Mock).toHaveBeenCalledWith(
      'patch/123/gallery/456.avif'
    )
  })

  it('keeps a successful upload when cache invalidation fails', async () => {
    invalidatePatchContentCacheMock.mockRejectedValue(
      new Error('cache failed')
    )

    const response = await POST(createGalleryRequest())

    await expect(response.json()).resolves.toEqual({
      imageId: 456,
      url: 'https://img.example/patch/123/gallery/456.webp',
      thumbnailUrl: 'https://img.example/patch/123/gallery/thumbnail/456.webp'
    })
    expect(prismaMocks.patch_game_image.delete).not.toHaveBeenCalled()
    expect(deleteFileFromS3Mock).not.toHaveBeenCalled()
  })
})
