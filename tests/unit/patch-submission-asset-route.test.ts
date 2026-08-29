import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const csrfMock = vi.hoisted(() => vi.fn())
vi.mock('~/middleware/_csrf', () => ({ verifyKunCsrf: csrfMock }))

const authMock = vi.hoisted(() => vi.fn())
vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: authMock
}))

const serviceMocks = vi.hoisted(() => ({
  deletePatchSubmissionGalleryImages: vi.fn(),
  updatePatchSubmissionGalleryNSFW: vi.fn(),
  uploadPatchSubmissionBanner: vi.fn(),
  uploadPatchSubmissionGalleryImage: vi.fn()
}))
vi.mock('~/app/api/patch-submission/assets', () => serviceMocks)

vi.mock('~/app/api/patch-submission/rateLimit', () => ({
  checkPatchSubmissionRateLimit: vi.fn()
}))

import { DELETE, PATCH, POST } from '~/app/api/patch-submission/asset/route'

beforeEach(() => {
  vi.clearAllMocks()
  csrfMock.mockReturnValue(null)
  authMock.mockResolvedValue({ uid: 7, role: 1 })
  serviceMocks.updatePatchSubmissionGalleryNSFW.mockResolvedValue({})
  serviceMocks.deletePatchSubmissionGalleryImages.mockResolvedValue({})
  serviceMocks.uploadPatchSubmissionGalleryImage.mockResolvedValue({
    galleryId: 9,
    alreadyUploaded: false
  })
})

describe('patch submission gallery PATCH', () => {
  it('verifies CSRF inside the excluded upload route before auth or body work', async () => {
    csrfMock.mockReturnValue('CSRF 校验失败')
    const response = await PATCH(
      new NextRequest('https://example.test/api/patch-submission/asset', {
        method: 'PATCH',
        body: JSON.stringify({
          submissionId: 1,
          galleryIds: [9],
          isNSFW: true
        })
      })
    )

    expect(response.status).toBe(403)
    expect(authMock).not.toHaveBeenCalled()
    expect(serviceMocks.updatePatchSubmissionGalleryNSFW).not.toHaveBeenCalled()
  })

  it('passes only validated ids and the authenticated owner to the service', async () => {
    const response = await PATCH(
      new NextRequest('https://example.test/api/patch-submission/asset', {
        method: 'PATCH',
        body: JSON.stringify({
          submissionId: 1,
          galleryIds: [9, 10],
          isNSFW: true
        })
      })
    )

    expect(serviceMocks.updatePatchSubmissionGalleryNSFW).toHaveBeenCalledWith({
      submissionId: 1,
      galleryIds: [9, 10],
      userId: 7,
      isNSFW: true
    })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })
})

describe('patch submission gallery POST', () => {
  it('passes the selected watermark option to image preparation', async () => {
    const formData = new FormData()
    formData.set('submissionId', '1')
    formData.set('clientAssetId', 'client-asset-9')
    formData.set(
      'image',
      new File([new Uint8Array([0xff, 0xd8, 0xff])], 'image.jpg', {
        type: 'image/jpeg'
      })
    )
    formData.set('watermark', 'true')

    await POST(
      new NextRequest('https://example.test/api/patch-submission/asset', {
        method: 'POST',
        body: formData
      })
    )

    expect(serviceMocks.uploadPatchSubmissionGalleryImage).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: 1,
        userId: 7,
        watermark: true
      })
    )
  })
})

describe('patch submission gallery DELETE', () => {
  const deleteRequest = (body: unknown) =>
    new NextRequest('https://example.test/api/patch-submission/asset', {
      method: 'DELETE',
      body: JSON.stringify(body)
    })

  it('passes every validated id and the authenticated owner to the service', async () => {
    const response = await DELETE(
      deleteRequest({ submissionId: 1, galleryIds: [9, 10] })
    )

    expect(
      serviceMocks.deletePatchSubmissionGalleryImages
    ).toHaveBeenCalledWith(1, [9, 10], 7)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('rejects an empty selection before reaching the service', async () => {
    const response = await DELETE(
      deleteRequest({ submissionId: 1, galleryIds: [] })
    )

    await expect(response.json()).resolves.toBe('请至少选择一张截图')
    expect(
      serviceMocks.deletePatchSubmissionGalleryImages
    ).not.toHaveBeenCalled()
  })
})
