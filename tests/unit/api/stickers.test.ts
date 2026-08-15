import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  sticker_pack: {
    findMany: vi.fn()
  },
  sticker: {
    findUnique: vi.fn()
  },
  user_sticker_pack: {
    findUnique: vi.fn()
  }
}))

const verifyHeaderCookieMock = vi.hoisted(() => vi.fn())
const rateLimitMock = vi.hoisted(() => ({
  checkConversationActionRateLimit: vi.fn()
}))

vi.mock('~/prisma/index', () => ({ prisma: prismaMock }))
vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: verifyHeaderCookieMock
}))
vi.mock('~/app/api/message/conversation/rateLimit', () => rateLimitMock)

describe('private chat sticker catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyHeaderCookieMock.mockResolvedValue({ uid: 1007 })
    rateLimitMock.checkConversationActionRateLimit.mockResolvedValue({
      allowed: true
    })
  })

  it('returns active sticker packs with poster metadata and no-store headers', async () => {
    prismaMock.sticker_pack.findMany.mockResolvedValue([
      {
        id: 4,
        slug: 'moe',
        name: 'Moe',
        description: '内置贴纸',
        cover_url: null,
        price: 0,
        status: 1,
        is_builtin: true,
        sort_order: 0,
        stickers: [
          {
            id: 'moe-wave',
            pack_id: 4,
            alt: '挥手',
            asset_url: 'https://cdn.example/moe-wave.webm',
            thumbnail_url: 'https://cdn.example/moe-wave.webp',
            storage_key: 'sticker/moe/moe-wave/asset.webm',
            thumbnail_storage_key: 'sticker/moe/moe-wave/poster.webp',
            mime: 'video/webm',
            media_type: 'video',
            width: 512,
            height: 512,
            size: 12000,
            duration_ms: 1200,
            frame_rate: 30,
            sort_order: 0
          }
        ]
      }
    ])

    const { GET } = await import('~/app/api/message/stickers/route')
    const response = await GET(
      new Request('https://www.otoame.top/api/message/stickers') as never
    )

    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toMatchObject({
      packs: [
        {
          id: 4,
          stickers: [
            {
              id: 'moe-wave',
              mediaType: 'video',
              thumbnailUrl: 'https://cdn.example/moe-wave.webp'
            }
          ]
        }
      ]
    })
    expect(prismaMock.sticker_pack.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 1, is_builtin: true }
      })
    )
    expect(rateLimitMock.checkConversationActionRateLimit).toHaveBeenCalledWith(
      'message-read',
      1007
    )
  })

  it('does not read the catalog when the personalized read limit is hit', async () => {
    rateLimitMock.checkConversationActionRateLimit.mockResolvedValue({
      allowed: false,
      message: '消息读取过于频繁，请 45 秒后再试',
      retryAfterMs: 45_000
    })

    const { GET } = await import('~/app/api/message/stickers/route')
    const response = await GET(
      new Request('https://www.otoame.top/api/message/stickers') as never
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('45')
    await expect(response.json()).resolves.toBe(
      '消息读取过于频繁，请 45 秒后再试'
    )
    expect(prismaMock.sticker_pack.findMany).not.toHaveBeenCalled()
  })

  it('rejects sending a sticker from an offline pack', async () => {
    prismaMock.sticker.findUnique.mockResolvedValue({
      id: 'offline-wave',
      pack_id: 9,
      alt: '禁用',
      asset_url: 'https://cdn.example/offline-wave.webm',
      thumbnail_url: 'https://cdn.example/offline-wave.webp',
      storage_key: 'sticker/offline/offline-wave/asset.webm',
      thumbnail_storage_key: 'sticker/offline/offline-wave/poster.webp',
      mime: 'video/webm',
      media_type: 'video',
      width: 512,
      height: 512,
      size: 12000,
      duration_ms: 1000,
      frame_rate: 30,
      sort_order: 0,
      pack: {
        id: 9,
        slug: 'offline',
        name: '禁用包',
        description: '',
        cover_url: null,
        price: 0,
        status: 0,
        is_builtin: true
      }
    })

    const { getStickerForSending } = await import(
      '~/app/api/message/stickers/service'
    )
    await expect(getStickerForSending('offline-wave', 1007)).resolves.toBe(
      '贴纸包已禁用，暂时无法发送'
    )
  })

  it('does not enable future non-built-in packs in the built-in-only phase', async () => {
    prismaMock.sticker.findUnique.mockResolvedValue({
      id: 'premium-wave',
      pack_id: 10,
      alt: '高级挥手',
      asset_url: 'https://cdn.example/premium-wave.webp',
      thumbnail_url: null,
      storage_key: 'sticker/premium/premium-wave/asset.webp',
      thumbnail_storage_key: null,
      mime: 'image/webp',
      media_type: 'image',
      width: 512,
      height: 512,
      size: 12000,
      duration_ms: null,
      frame_rate: null,
      sort_order: 0,
      pack: {
        id: 10,
        slug: 'premium',
        name: 'Premium',
        description: '',
        cover_url: null,
        price: 100,
        status: 1,
        is_builtin: false
      }
    })
    const { getStickerForSending } = await import(
      '~/app/api/message/stickers/service'
    )
    await expect(getStickerForSending('premium-wave', 1007)).resolves.toBe(
      '当前阶段仅支持内置贴纸包'
    )
    expect(prismaMock.user_sticker_pack.findUnique).not.toHaveBeenCalled()
  })
})
