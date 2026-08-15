import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const verifyHeaderCookieMock = vi.hoisted(() => vi.fn())
const getAdminStickerPacksMock = vi.hoisted(() => vi.fn())
const createStickerPackMock = vi.hoisted(() => vi.fn())
const importStickerAssetsMock = vi.hoisted(() => vi.fn())
const updateStickerStatusesMock = vi.hoisted(() => vi.fn())
const deleteStickersMock = vi.hoisted(() => vi.fn())
const deleteStickerPackMock = vi.hoisted(() => vi.fn())

vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: verifyHeaderCookieMock
}))
vi.mock('~/app/api/admin/stickers/service', () => ({
  getAdminStickerPacks: getAdminStickerPacksMock,
  createStickerPack: createStickerPackMock,
  deleteStickerPack: deleteStickerPackMock,
  deleteStickers: deleteStickersMock,
  importStickerAssets: importStickerAssetsMock,
  updateStickerPack: vi.fn(),
  updateStickerStatus: vi.fn(),
  updateStickerStatuses: updateStickerStatusesMock
}))

describe('admin Sticker route authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_KUN_PATCH_ADDRESS_DEV = 'https://www.otoame.top'
  })

  it('does not expose the catalog to non-admin users', async () => {
    verifyHeaderCookieMock.mockResolvedValue({ uid: 8, role: 2 })
    const { GET } = await import('~/app/api/admin/stickers/route')

    const response = await GET(
      new NextRequest('https://www.otoame.top/api/admin/stickers')
    )

    await expect(response.json()).resolves.toBe('本页面仅管理员可访问')
    expect(getAdminStickerPacksMock).not.toHaveBeenCalled()
  })

  it('does not allow non-admin users to create a Pack', async () => {
    verifyHeaderCookieMock.mockResolvedValue({ uid: 8, role: 2 })
    const { POST } = await import('~/app/api/admin/stickers/packs/route')

    const response = await POST(
      new NextRequest('https://www.otoame.top/api/admin/stickers/packs', {
        method: 'POST',
        headers: {
          'x-requested-with': 'kun-fetch',
          origin: 'https://www.otoame.top'
        },
        body: JSON.stringify({
          slug: 'cute_cats',
          name: 'Cute Cats',
          description: ''
        })
      })
    )

    await expect(response.json()).resolves.toBe('本页面仅管理员可访问')
    expect(createStickerPackMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the Sticker import multipart body is incomplete', async () => {
    verifyHeaderCookieMock.mockResolvedValue({ uid: 8, role: 3 })
    const request = new NextRequest(
      'https://www.otoame.top/api/admin/stickers/import',
      {
        method: 'POST',
        headers: {
          'x-requested-with': 'kun-fetch',
          origin: 'https://www.otoame.top'
        }
      }
    )
    const formDataSpy = vi
      .spyOn(request, 'formData')
      .mockRejectedValue(new TypeError('expected boundary after body'))

    const { POST } = await import('~/app/api/admin/stickers/import/route')
    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toBe(
      'Sticker 上传请求不完整，请重新选择文件后重试'
    )
    expect(formDataSpy).toHaveBeenCalledTimes(1)
    expect(importStickerAssetsMock).not.toHaveBeenCalled()
  })

  it('accepts a 30 MiB Sticker ZIP Pack', async () => {
    verifyHeaderCookieMock.mockResolvedValue({ uid: 8, role: 3 })
    importStickerAssetsMock.mockResolvedValue({ id: 1, stickers: [] })

    const zipFile = new File(
      [new Uint8Array([0x50, 0x4b, 0x03, 0x04])],
      'moe-pack.zip',
      { type: 'application/zip' }
    )
    Object.defineProperty(zipFile, 'size', { value: 30 * 1024 * 1024 })
    const formData = new FormData()
    formData.append('packId', '1')
    formData.append('files', zipFile)

    const request = new NextRequest(
      'https://www.otoame.top/api/admin/stickers/import',
      {
        method: 'POST',
        headers: {
          'x-requested-with': 'kun-fetch',
          origin: 'https://www.otoame.top'
        }
      }
    )
    vi.spyOn(request, 'formData').mockResolvedValue(formData)

    const { POST } = await import('~/app/api/admin/stickers/import/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(importStickerAssetsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        packId: 1,
        uid: 8,
        files: [expect.objectContaining({ name: 'moe-pack.zip' })]
      })
    )
  })

  it('checks CSRF inside the Sticker import route before reading the body', async () => {
    const request = new NextRequest(
      'https://www.otoame.top/api/admin/stickers/import',
      { method: 'POST' }
    )
    const formDataSpy = vi.spyOn(request, 'formData')

    const { POST } = await import('~/app/api/admin/stickers/import/route')
    const response = await POST(request)

    expect(response.status).toBe(403)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toBe('非法请求来源')
    expect(verifyHeaderCookieMock).not.toHaveBeenCalled()
    expect(formDataSpy).not.toHaveBeenCalled()
    expect(importStickerAssetsMock).not.toHaveBeenCalled()
  })

  it('passes a validated batch status update to the admin service', async () => {
    verifyHeaderCookieMock.mockResolvedValue({ uid: 8, role: 3 })
    updateStickerStatusesMock.mockResolvedValue({ id: 4 })
    const { PUT } = await import('~/app/api/admin/stickers/items/route')

    const response = await PUT(
      new NextRequest('https://www.otoame.top/api/admin/stickers/items', {
        method: 'PUT',
        headers: {
          'x-requested-with': 'kun-fetch',
          origin: 'https://www.otoame.top'
        },
        body: JSON.stringify({
          stickerIds: ['cute_cats_happy', 'cute_cats_wave'],
          status: 0
        })
      })
    )

    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(updateStickerStatusesMock).toHaveBeenCalledWith(
      {
        stickerIds: ['cute_cats_happy', 'cute_cats_wave'],
        status: 0
      },
      8
    )
  })

  it('does not allow non-admin users to delete Stickers', async () => {
    verifyHeaderCookieMock.mockResolvedValue({ uid: 8, role: 2 })
    const { DELETE } = await import('~/app/api/admin/stickers/items/route')

    const response = await DELETE(
      new NextRequest('https://www.otoame.top/api/admin/stickers/items', {
        method: 'DELETE',
        headers: {
          'x-requested-with': 'kun-fetch',
          origin: 'https://www.otoame.top'
        },
        body: JSON.stringify({ stickerIds: ['cute_cats_wave'] })
      })
    )

    await expect(response.json()).resolves.toBe('本页面仅管理员可访问')
    expect(deleteStickersMock).not.toHaveBeenCalled()
  })
})
