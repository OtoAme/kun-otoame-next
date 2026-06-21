import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  uploadImageToS3: vi.fn(),
  deleteFileFromS3: vi.fn(),
  checkBufferSize: vi.fn()
}))

vi.mock('~/lib/s3', () => ({
  uploadImageToS3: mocks.uploadImageToS3,
  deleteFileFromS3: mocks.deleteFileFromS3
}))

vi.mock('~/app/api/utils/checkBufferSize', () => ({
  checkBufferSize: mocks.checkBufferSize
}))

vi.mock('sharp', () => {
  const sharpMock = vi.fn(() => ({
    resize: vi.fn().mockReturnThis(),
    avif: vi.fn().mockReturnThis(),
    toBuffer: vi.fn(async () => Buffer.from('avif'))
  }))
  return { default: sharpMock }
})

import {
  cleanupUploadedPatchBanner,
  uploadPatchBanner
} from '~/app/api/edit/_upload'

describe('patch banner upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.uploadImageToS3.mockResolvedValue(undefined)
    mocks.deleteFileFromS3.mockResolvedValue(undefined)
    mocks.checkBufferSize.mockReturnValue(true)
  })

  it('returns the public banner URL and uploaded keys', async () => {
    process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL = 'https://img.example'

    const result = await uploadPatchBanner(new ArrayBuffer(1), 42)

    expect(result).toEqual({
      imageLink: 'https://img.example/patch/42/banner/banner.avif',
      uploadedKeys: [
        'patch/42/banner/banner.avif',
        'patch/42/banner/banner-mini.avif'
      ]
    })
  })

  it('cleans already uploaded keys when a later upload fails', async () => {
    const error = new Error('s3 closed connection')
    mocks.uploadImageToS3
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(error)

    await expect(uploadPatchBanner(new ArrayBuffer(1), 42)).rejects.toThrow(
      's3 closed connection'
    )

    expect(mocks.deleteFileFromS3).toHaveBeenCalledWith(
      'patch/42/banner/banner.avif'
    )
  })

  it('exposes cleanup for downstream create failures', async () => {
    await cleanupUploadedPatchBanner([
      'patch/42/banner/banner.avif',
      'patch/42/banner/banner-mini.avif'
    ])

    expect(mocks.deleteFileFromS3).toHaveBeenCalledWith(
      'patch/42/banner/banner.avif'
    )
    expect(mocks.deleteFileFromS3).toHaveBeenCalledWith(
      'patch/42/banner/banner-mini.avif'
    )
  })
})
