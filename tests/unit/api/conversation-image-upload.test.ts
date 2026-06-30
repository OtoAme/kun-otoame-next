import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user_conversation: { findUnique: vi.fn() }
}))

const s3Mock = vi.hoisted(() => ({
  uploadImageToS3: vi.fn()
}))

vi.mock('~/prisma/index', () => ({ prisma: prismaMock }))
vi.mock('~/lib/s3', () => s3Mock)

vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    metadata: vi.fn().mockResolvedValue({ width: 800, height: 600 })
  }))
}))

describe('conversation image upload service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

    await expect(uploadConversationImage(5, file, 1007)).resolves.toMatchObject({
      url: expect.stringMatching(
        /^https:\/\/img\.example\/conversation\/5\/.+\.webp$/
      ),
      width: 800,
      height: 600,
      size: file.size,
      mime: 'image/webp',
      name: 'chat.webp'
    })
    expect(s3Mock.uploadImageToS3).toHaveBeenCalledWith(
      expect.stringMatching(/^conversation\/5\/.+\.webp$/),
      expect.any(Buffer),
      'image/webp'
    )
  })
})
