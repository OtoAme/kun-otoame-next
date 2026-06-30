import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user_conversation: { findUnique: vi.fn() }
}))

const s3Mock = vi.hoisted(() => ({
  uploadImageToS3: vi.fn()
}))

const sharpMock = vi.hoisted(() => vi.fn())

vi.mock('~/prisma/index', () => ({ prisma: prismaMock }))
vi.mock('~/lib/s3', () => s3Mock)

vi.mock('sharp', () => ({
  default: sharpMock
}))

describe('conversation image upload service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sharpMock.mockReturnValue({
      resize: vi.fn().mockReturnThis(),
      avif: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(Buffer.from('compressed-avif')),
      metadata: vi.fn().mockResolvedValue({ width: 800, height: 600 })
    })
    process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL = 'https://img.example'
    prismaMock.user_conversation.findUnique.mockResolvedValue({
      id: 5,
      user_a_id: 1007,
      user_b_id: 8
    })
  })

  it('rejects uploads when the user is not in the conversation', async () => {
    prismaMock.user_conversation.findUnique.mockResolvedValue({
      id: 5,
      user_a_id: 1,
      user_b_id: 2
    })
    const { uploadConversationImage } = await import(
      '~/app/api/message/conversation/[id]/image/service'
    )

    const file = new File(['x'], 'a.png', { type: 'image/png' })
    await expect(uploadConversationImage(5, file, 1007)).resolves.toBe(
      '会话不存在或无权访问'
    )
  })

  it('rejects files over 8 MB', async () => {
    const { uploadConversationImage } = await import(
      '~/app/api/message/conversation/[id]/image/service'
    )
    const file = new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'big.png', {
      type: 'image/png'
    })

    await expect(uploadConversationImage(5, file, 1007)).resolves.toBe(
      '图片大小不能超过 8 MB'
    )
  })

  it('uploads valid images and returns message image metadata', async () => {
    const { uploadConversationImage } = await import(
      '~/app/api/message/conversation/[id]/image/service'
    )
    const file = new File(['image'], 'chat.webp', { type: 'image/webp' })

    await expect(uploadConversationImage(5, file, 1007)).resolves.toMatchObject(
      {
        url: expect.stringMatching(
          /^https:\/\/img\.example\/conversation\/5\/.+\.avif$/
        ),
        width: 800,
        height: 600,
        size: Buffer.from('compressed-avif').length,
        mime: 'image/avif',
        name: 'chat.avif'
      }
    )
    expect(s3Mock.uploadImageToS3).toHaveBeenCalledWith(
      expect.stringMatching(/^conversation\/5\/.+\.avif$/),
      Buffer.from('compressed-avif'),
      'image/avif'
    )
  })

  it('rejects images when the compressed AVIF is still too large', async () => {
    sharpMock.mockReturnValue({
      resize: vi.fn().mockReturnThis(),
      avif: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(Buffer.alloc(1.5 * 1024 * 1024 + 1)),
      metadata: vi.fn().mockResolvedValue({ width: 800, height: 600 })
    })

    const { uploadConversationImage } = await import(
      '~/app/api/message/conversation/[id]/image/service'
    )
    const file = new File(['image'], 'chat.png', { type: 'image/png' })

    await expect(uploadConversationImage(5, file, 1007)).resolves.toBe(
      '图片压缩后仍超过 1.5 MB'
    )
    expect(s3Mock.uploadImageToS3).not.toHaveBeenCalled()
  })
})
