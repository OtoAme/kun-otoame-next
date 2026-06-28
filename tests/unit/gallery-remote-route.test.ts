import { beforeEach, describe, expect, it, vi } from 'vitest'

const verifyHeaderCookieMock = vi.hoisted(() => vi.fn())
const importRemoteGalleryImageMock = vi.hoisted(() => vi.fn())

vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: verifyHeaderCookieMock
}))

vi.mock('~/app/api/edit/galleryRemoteImport', () => ({
  importRemoteGalleryImage: importRemoteGalleryImageMock
}))

import { POST } from '~/app/api/edit/gallery/remote/route'

const createRequest = (body: unknown) =>
  ({
    json: vi.fn().mockResolvedValue(body)
  }) as any

describe('gallery remote import route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    verifyHeaderCookieMock.mockResolvedValue({ uid: 1, role: 3 })
    importRemoteGalleryImageMock.mockResolvedValue({
      fileName: 'sample.jpg',
      contentType: 'image/jpeg',
      base64: 'anBlZw=='
    })
  })

  it('requires administrator access before importing remote images', async () => {
    verifyHeaderCookieMock.mockResolvedValue({ uid: 1, role: 2 })

    const response = await POST(
      createRequest({ url: 'https://img.example/sample.jpg' })
    )

    await expect(response.json()).resolves.toBe('本页面仅管理员可访问')
    expect(importRemoteGalleryImageMock).not.toHaveBeenCalled()
  })

  it('imports a validated remote image URL', async () => {
    const response = await POST(
      createRequest({ url: 'https://img.example/sample.jpg' })
    )

    await expect(response.json()).resolves.toEqual({
      fileName: 'sample.jpg',
      contentType: 'image/jpeg',
      base64: 'anBlZw=='
    })
    expect(importRemoteGalleryImageMock).toHaveBeenCalledWith(
      'https://img.example/sample.jpg'
    )
  })
})
