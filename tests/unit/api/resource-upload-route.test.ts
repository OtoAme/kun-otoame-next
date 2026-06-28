import { beforeEach, describe, expect, it, vi } from 'vitest'

const setUploadMetadataMock = vi.hoisted(() => vi.fn())
const calculateFileStreamHashMock = vi.hoisted(() => vi.fn())
const verifyHeaderCookieMock = vi.hoisted(() => vi.fn())
const verifyKunCsrfMock = vi.hoisted(() => vi.fn())
const prismaMocks = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    updateMany: vi.fn()
  },
  patch_resource: {
    findFirst: vi.fn()
  }
}))

vi.mock('~/lib/redis', () => ({
  setUploadMetadata: setUploadMetadataMock
}))

vi.mock('~/app/api/upload/resourceUtils', () => ({
  calculateFileStreamHash: calculateFileStreamHashMock
}))

vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: verifyHeaderCookieMock
}))

vi.mock('~/middleware/_csrf', () => ({
  verifyKunCsrf: verifyKunCsrfMock
}))

vi.mock('~/prisma', () => ({
  prisma: prismaMocks
}))

vi.mock('~/app/api/utils/verifyKunCaptcha', () => ({
  checkKunCaptchaExist: vi.fn()
}))

import { POST } from '~/app/api/upload/resource/route'

const createUploadRequest = (file: File) => {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('captcha', '')

  return {
    formData: vi.fn().mockResolvedValue(formData)
  } as any
}

describe('resource upload route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyKunCsrfMock.mockReturnValue(null)
    verifyHeaderCookieMock.mockResolvedValue({ uid: 1 })
    prismaMocks.user.findUnique.mockResolvedValue({
      id: 1,
      role: 3,
      moemoepoint: 100,
      daily_upload_size: 0
    })
    prismaMocks.patch_resource.findFirst.mockResolvedValue(null)
    prismaMocks.user.updateMany.mockResolvedValue({ count: 1 })
    calculateFileStreamHashMock.mockResolvedValue({
      fileHash: 'hash-1024',
      finalFilePath: 'uploads/upload-id/save.zip',
      uploadDir: 'uploads/upload-id'
    })
    setUploadMetadataMock.mockResolvedValue(undefined)
  })

  it('accepts a 1024-byte compressed resource upload', async () => {
    const file = new File([Buffer.alloc(1024)], 'save.zip', {
      type: 'application/zip'
    })

    const response = await POST(createUploadRequest(file))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      filetype: 's3',
      fileHash: 'hash-1024',
      fileSize: '0.001 MB'
    })
    expect(calculateFileStreamHashMock).toHaveBeenCalledWith(
      expect.any(Buffer),
      'uploads',
      expect.any(String),
      'save.zip'
    )
    expect(setUploadMetadataMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        userId: 1,
        sizeBytes: 1024,
        size: '0.001 MB',
        filename: 'save.zip'
      }),
      24 * 60 * 60
    )
  })
})
