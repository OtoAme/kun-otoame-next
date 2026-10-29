import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  checkCaseRateLimit: vi.fn(),
  uploadImageToS3: vi.fn(),
  toBuffer: vi.fn()
}))

vi.mock('~/app/api/case/rateLimit', () => ({
  checkCaseRateLimit: mocks.checkCaseRateLimit
}))
vi.mock('~/lib/s3', () => ({ uploadImageToS3: mocks.uploadImageToS3 }))
vi.mock('sharp', () => ({
  default: () => ({
    resize: () => ({ avif: () => ({ toBuffer: mocks.toBuffer }) })
  })
}))

import { uploadHelpImage } from '~/app/api/help/imageUpload'

const file = (type: string, bytes = 10) =>
  new File([new Uint8Array(bytes)], 'a', { type })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkCaseRateLimit.mockResolvedValue(null)
  mocks.toBuffer.mockResolvedValue(Buffer.alloc(100))
  mocks.uploadImageToS3.mockResolvedValue(undefined)
  process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL = 'https://img.example'
})

describe('help image upload', () => {
  it('stores an AVIF under the uploader and returns its URL', async () => {
    const result = await uploadHelpImage(file('image/png'), 7)

    expect(result).toMatchObject({
      url: expect.stringMatching(
        /^https:\/\/img\.example\/help\/7\/\d+-.+\.avif$/
      )
    })
    expect(mocks.uploadImageToS3).toHaveBeenCalledWith(
      expect.stringMatching(/^help\/7\//),
      expect.any(Buffer),
      'image/avif'
    )
  })

  it('refuses other types and oversize files before storage', async () => {
    expect(await uploadHelpImage(file('image/gif'), 7)).toBe(
      '仅支持 JPG、PNG、WebP、AVIF 图片'
    )
    expect(
      await uploadHelpImage(file('image/png', 9 * 1024 * 1024), 7)
    ).toContain('图片大小不能超过')
    expect(mocks.uploadImageToS3).not.toHaveBeenCalled()
  })

  it('stops at the shared upload rate limit', async () => {
    mocks.checkCaseRateLimit.mockResolvedValue(
      '图片上传过于频繁，请 30 秒后再试'
    )

    expect(await uploadHelpImage(file('image/jpeg'), 7)).toContain('过于频繁')
    expect(mocks.uploadImageToS3).not.toHaveBeenCalled()
  })
})
