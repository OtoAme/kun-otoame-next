import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn()
  },
  user_conversation: { findUnique: vi.fn() }
}))

const s3Mock = vi.hoisted(() => ({
  uploadImageToS3: vi.fn(),
  deleteFileFromS3: vi.fn()
}))

const redisMock = vi.hoisted(() => ({
  setKv: vi.fn(),
  getKvs: vi.fn()
}))

const rateLimitMock = vi.hoisted(() => ({
  CONVERSATION_IMAGE_UPLOAD_OVERAGE_MOEMOEPOINT_COST: 5,
  checkConversationActionRateLimit: vi.fn(),
  consumeConversationImageUploadQuota: vi.fn(),
  rollbackConversationImageUploadQuota: vi.fn()
}))

const sharpMock = vi.hoisted(() => vi.fn())
const verifyHeaderCookieMock = vi.hoisted(() => vi.fn())
const verifyKunCsrfMock = vi.hoisted(() => vi.fn())

vi.mock('~/prisma/index', () => ({ prisma: prismaMock }))
vi.mock('~/lib/s3', () => s3Mock)
vi.mock('~/lib/redis', () => redisMock)
vi.mock('~/app/api/message/conversation/rateLimit', () => rateLimitMock)
vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: verifyHeaderCookieMock
}))
vi.mock('~/middleware/_csrf', () => ({
  verifyKunCsrf: verifyKunCsrfMock
}))

vi.mock('sharp', () => ({
  default: sharpMock
}))

describe('conversation image upload service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitMock.checkConversationActionRateLimit.mockReset()
    rateLimitMock.consumeConversationImageUploadQuota.mockReset()
    rateLimitMock.rollbackConversationImageUploadQuota.mockReset()
    sharpMock.mockReturnValue({
      resize: vi.fn().mockReturnThis(),
      avif: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(Buffer.from('compressed-avif')),
      metadata: vi.fn().mockResolvedValue({ width: 800, height: 600 })
    })
    process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL = 'https://img.example'
    verifyHeaderCookieMock.mockResolvedValue({ uid: 1007 })
    verifyKunCsrfMock.mockReturnValue(null)
    prismaMock.user_conversation.findUnique.mockResolvedValue({
      id: 5,
      user_a_id: 1007,
      user_b_id: 8
    })
    prismaMock.user.findUnique.mockResolvedValue({
      id: 8,
      allow_private_message: true
    })
    rateLimitMock.checkConversationActionRateLimit.mockResolvedValue({
      allowed: true
    })
    rateLimitMock.consumeConversationImageUploadQuota.mockResolvedValue({
      counted: true,
      count: 1,
      cost: 0,
      ttlSeconds: 60 * 60
    })
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.user.update.mockResolvedValue({})
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

  it('rejects uploads when the recipient has disabled private messages before quota or S3 work', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 8,
      allow_private_message: false
    })

    const { uploadConversationImage } = await import(
      '~/app/api/message/conversation/[id]/image/service'
    )
    const file = new File(['image'], 'chat.png', { type: 'image/png' })

    await expect(uploadConversationImage(5, file, 1007)).resolves.toBe(
      '对方已关闭接收私信'
    )
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: 8 },
      select: { id: true, allow_private_message: true }
    })
    expect(
      rateLimitMock.checkConversationActionRateLimit
    ).not.toHaveBeenCalled()
    expect(
      rateLimitMock.consumeConversationImageUploadQuota
    ).not.toHaveBeenCalled()
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled()
    expect(sharpMock).not.toHaveBeenCalled()
    expect(s3Mock.uploadImageToS3).not.toHaveBeenCalled()
  })

  it('rejects uploads when the user exceeds the private chat image upload rate limit', async () => {
    rateLimitMock.checkConversationActionRateLimit.mockResolvedValueOnce({
      allowed: false,
      message: '图片上传过于频繁，请 60 秒后再试',
      retryAfterMs: 60_000
    })

    const { uploadConversationImage } = await import(
      '~/app/api/message/conversation/[id]/image/service'
    )
    const file = new File(['image'], 'chat.png', { type: 'image/png' })

    await expect(uploadConversationImage(5, file, 1007)).resolves.toEqual({
      kind: 'conversation-rate-limit',
      message: '图片上传过于频繁，请 60 秒后再试',
      retryAfterMs: 60_000
    })
    expect(rateLimitMock.checkConversationActionRateLimit).toHaveBeenCalledWith(
      'image-upload',
      1007
    )
    expect(sharpMock).not.toHaveBeenCalled()
    expect(s3Mock.uploadImageToS3).not.toHaveBeenCalled()
  })

  it('returns 429 with retry-after when the image upload route is rate limited', async () => {
    rateLimitMock.checkConversationActionRateLimit
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({
        allowed: false,
        message: '图片上传过于频繁，请 2 秒后再试',
        retryAfterMs: 1_200
      })
    const formData = new FormData()
    formData.append(
      'image',
      new File(['image'], 'chat.png', { type: 'image/png' })
    )

    const { POST } = await import(
      '~/app/api/message/conversation/[id]/image/route'
    )
    const response = await POST(
      new Request('https://www.otoame.top/api/message/conversation/5/image', {
        method: 'POST',
        body: formData
      }) as never,
      { params: Promise.resolve({ id: '5' }) }
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('retry-after')).toBe('2')
    await expect(response.json()).resolves.toBe(
      '图片上传过于频繁，请 2 秒后再试'
    )
    expect(sharpMock).not.toHaveBeenCalled()
    expect(s3Mock.uploadImageToS3).not.toHaveBeenCalled()
  })

  it('returns 429 before parsing multipart data when image upload intake is rate limited', async () => {
    rateLimitMock.checkConversationActionRateLimit.mockResolvedValueOnce({
      allowed: false,
      message: '图片上传请求过于频繁，请 20 秒后再试',
      retryAfterMs: 20_000
    })
    const request = new Request(
      'https://www.otoame.top/api/message/conversation/5/image',
      { method: 'POST' }
    )
    const formDataSpy = vi
      .spyOn(request, 'formData')
      .mockRejectedValue(new Error('multipart should not be parsed'))

    const { POST } = await import(
      '~/app/api/message/conversation/[id]/image/route'
    )
    const response = await POST(request as never, {
      params: Promise.resolve({ id: '5' })
    })

    expect(response.status).toBe(429)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('retry-after')).toBe('20')
    await expect(response.json()).resolves.toBe(
      '图片上传请求过于频繁，请 20 秒后再试'
    )
    expect(rateLimitMock.checkConversationActionRateLimit).toHaveBeenCalledWith(
      'image-upload-intake',
      1007
    )
    expect(formDataSpy).not.toHaveBeenCalled()
    expect(prismaMock.user_conversation.findUnique).not.toHaveBeenCalled()
    expect(sharpMock).not.toHaveBeenCalled()
    expect(s3Mock.uploadImageToS3).not.toHaveBeenCalled()
  })

  it('returns 413 with a user-visible reason when multipart parsing rejects an oversized image', async () => {
    const request = new Request(
      'https://www.otoame.top/api/message/conversation/5/image',
      { method: 'POST' }
    )
    const formDataSpy = vi
      .spyOn(request, 'formData')
      .mockRejectedValue(new Error('Request body size exceeded 10 MB limit'))

    const { POST } = await import(
      '~/app/api/message/conversation/[id]/image/route'
    )
    const response = await POST(request as never, {
      params: Promise.resolve({ id: '5' })
    })

    expect(response.status).toBe(413)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toBe('图片大小不能超过 8 MB')
    expect(formDataSpy).toHaveBeenCalledTimes(1)
    expect(prismaMock.user_conversation.findUnique).not.toHaveBeenCalled()
    expect(sharpMock).not.toHaveBeenCalled()
    expect(s3Mock.uploadImageToS3).not.toHaveBeenCalled()
  })

  it('returns 413 before parsing multipart data when the request body exceeds the Next client body limit', async () => {
    const request = new Request(
      'https://www.otoame.top/api/message/conversation/5/image',
      {
        method: 'POST',
        headers: {
          'content-length': String(10 * 1024 * 1024 + 1)
        }
      }
    )
    const formDataSpy = vi
      .spyOn(request, 'formData')
      .mockRejectedValue(new Error('Failed to parse multipart body'))

    const { POST } = await import(
      '~/app/api/message/conversation/[id]/image/route'
    )
    const response = await POST(request as never, {
      params: Promise.resolve({ id: '5' })
    })

    expect(response.status).toBe(413)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toBe('图片大小不能超过 8 MB')
    expect(formDataSpy).not.toHaveBeenCalled()
    expect(prismaMock.user_conversation.findUnique).not.toHaveBeenCalled()
    expect(sharpMock).not.toHaveBeenCalled()
    expect(s3Mock.uploadImageToS3).not.toHaveBeenCalled()
  })

  it('returns 413 when the parsed private chat image is over 8 MB', async () => {
    const formData = new FormData()
    formData.append(
      'image',
      new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'big.png', {
        type: 'image/png'
      })
    )

    const { POST } = await import(
      '~/app/api/message/conversation/[id]/image/route'
    )
    const response = await POST(
      new Request('https://www.otoame.top/api/message/conversation/5/image', {
        method: 'POST',
        body: formData
      }) as never,
      { params: Promise.resolve({ id: '5' }) }
    )

    expect(response.status).toBe(413)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toBe('图片大小不能超过 8 MB')
    expect(sharpMock).not.toHaveBeenCalled()
    expect(s3Mock.uploadImageToS3).not.toHaveBeenCalled()
  })

  it('rejects extra hourly image uploads without enough moemoepoints before processing or S3 upload', async () => {
    const quotaReservation = {
      counted: true,
      count: 6,
      cost: 5,
      ttlSeconds: 30 * 60
    }
    rateLimitMock.consumeConversationImageUploadQuota.mockResolvedValueOnce(
      quotaReservation
    )
    prismaMock.user.updateMany.mockResolvedValueOnce({ count: 0 })

    const { uploadConversationImage } = await import(
      '~/app/api/message/conversation/[id]/image/service'
    )
    const file = new File(['image'], 'chat.png', { type: 'image/png' })

    await expect(uploadConversationImage(5, file, 1007)).resolves.toBe(
      '萌萌点不足，额外上传一张私聊图片需要 5 萌萌点'
    )
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: 1007, moemoepoint: { gte: 5 } },
      data: { moemoepoint: { decrement: 5 } }
    })
    expect(
      rateLimitMock.rollbackConversationImageUploadQuota
    ).toHaveBeenCalledWith(1007, quotaReservation)
    expect(sharpMock).not.toHaveBeenCalled()
    expect(s3Mock.uploadImageToS3).not.toHaveBeenCalled()
  })

  it('rejects image uploads before processing when the hourly quota cannot be reserved', async () => {
    rateLimitMock.consumeConversationImageUploadQuota.mockResolvedValueOnce({
      counted: false,
      count: 0,
      cost: 0,
      ttlSeconds: 0,
      unavailable: true
    })

    const { uploadConversationImage } = await import(
      '~/app/api/message/conversation/[id]/image/service'
    )
    const file = new File(['image'], 'chat.png', { type: 'image/png' })

    await expect(uploadConversationImage(5, file, 1007)).resolves.toBe(
      '图片上传系统繁忙，请稍后重试'
    )
    expect(sharpMock).not.toHaveBeenCalled()
    expect(s3Mock.uploadImageToS3).not.toHaveBeenCalled()
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
    expect(redisMock.setKv).toHaveBeenCalledWith(
      expect.stringMatching(/^conversation:image-upload:5:1007:[a-f0-9]{64}$/),
      expect.stringContaining('"url":"https://img.example/conversation/5/'),
      60 * 60
    )
  })

  it('charges moemoepoints for paid hourly image uploads and keeps the reservation after success', async () => {
    rateLimitMock.consumeConversationImageUploadQuota.mockResolvedValueOnce({
      counted: true,
      count: 6,
      cost: 5,
      ttlSeconds: 30 * 60
    })

    const { uploadConversationImage } = await import(
      '~/app/api/message/conversation/[id]/image/service'
    )
    const file = new File(['image'], 'chat.webp', { type: 'image/webp' })

    await expect(uploadConversationImage(5, file, 1007)).resolves.toMatchObject(
      {
        url: expect.stringMatching(
          /^https:\/\/img\.example\/conversation\/5\/.+\.avif$/
        ),
        mime: 'image/avif'
      }
    )
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: 1007, moemoepoint: { gte: 5 } },
      data: { moemoepoint: { decrement: 5 } }
    })
    expect(
      rateLimitMock.rollbackConversationImageUploadQuota
    ).not.toHaveBeenCalled()
    expect(prismaMock.user.update).not.toHaveBeenCalled()
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

  it('returns a user-visible error and rolls back quota when image processing fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const quotaReservation = {
      counted: true,
      count: 6,
      cost: 5,
      ttlSeconds: 30 * 60
    }
    rateLimitMock.consumeConversationImageUploadQuota.mockResolvedValueOnce(
      quotaReservation
    )
    sharpMock.mockReturnValueOnce({
      resize: vi.fn().mockReturnThis(),
      avif: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockRejectedValue(new Error('invalid image')),
      metadata: vi.fn()
    })

    const { uploadConversationImage } = await import(
      '~/app/api/message/conversation/[id]/image/service'
    )
    const file = new File(['not actually an image'], 'chat.png', {
      type: 'image/png'
    })

    await expect(uploadConversationImage(5, file, 1007)).resolves.toBe(
      '图片处理失败，请重新选择有效图片'
    )
    expect(
      rateLimitMock.rollbackConversationImageUploadQuota
    ).toHaveBeenCalledWith(1007, quotaReservation)
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 1007 },
      data: { moemoepoint: { increment: 5 } }
    })
    expect(s3Mock.uploadImageToS3).not.toHaveBeenCalled()
    expect(redisMock.setKv).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to process conversation image upload',
      expect.objectContaining({
        conversationId: 5,
        uid: 1007
      })
    )
    consoleError.mockRestore()
  })

  it('returns a retryable error and rolls back quota when S3 upload fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const quotaReservation = {
      counted: true,
      count: 6,
      cost: 5,
      ttlSeconds: 30 * 60
    }
    rateLimitMock.consumeConversationImageUploadQuota.mockResolvedValueOnce(
      quotaReservation
    )
    s3Mock.uploadImageToS3.mockRejectedValueOnce(new Error('s3 unavailable'))

    const { uploadConversationImage } = await import(
      '~/app/api/message/conversation/[id]/image/service'
    )
    const file = new File(['image'], 'chat.png', { type: 'image/png' })

    await expect(uploadConversationImage(5, file, 1007)).resolves.toBe(
      '图片上传到对象存储失败，请稍后重试'
    )
    expect(
      rateLimitMock.rollbackConversationImageUploadQuota
    ).toHaveBeenCalledWith(1007, quotaReservation)
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 1007 },
      data: { moemoepoint: { increment: 5 } }
    })
    expect(redisMock.setKv).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to upload conversation image',
      expect.objectContaining({
        conversationId: 5,
        uid: 1007,
        key: expect.stringMatching(/^conversation\/5\/.+\.avif$/)
      })
    )
    consoleError.mockRestore()
  })

  it('deletes the uploaded S3 object when upload metadata registration fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    redisMock.setKv.mockRejectedValueOnce(new Error('redis unavailable'))

    const { uploadConversationImage } = await import(
      '~/app/api/message/conversation/[id]/image/service'
    )
    const file = new File(['image'], 'chat.png', { type: 'image/png' })

    await expect(uploadConversationImage(5, file, 1007)).resolves.toBe(
      '图片上传记录保存失败，请稍后重试'
    )
    expect(s3Mock.uploadImageToS3).toHaveBeenCalledWith(
      expect.stringMatching(/^conversation\/5\/.+\.avif$/),
      Buffer.from('compressed-avif'),
      'image/avif'
    )
    expect(s3Mock.deleteFileFromS3).toHaveBeenCalledWith(
      expect.stringMatching(/^conversation\/5\/.+\.avif$/)
    )
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to register conversation image upload',
      expect.objectContaining({
        conversationId: 5,
        uid: 1007
      })
    )
    consoleError.mockRestore()
  })

  it('refunds paid image upload cost and rolls back quota when metadata registration fails', async () => {
    const quotaReservation = {
      counted: true,
      count: 6,
      cost: 5,
      ttlSeconds: 30 * 60
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    rateLimitMock.consumeConversationImageUploadQuota.mockResolvedValueOnce(
      quotaReservation
    )
    redisMock.setKv.mockRejectedValueOnce(new Error('redis unavailable'))

    const { uploadConversationImage } = await import(
      '~/app/api/message/conversation/[id]/image/service'
    )
    const file = new File(['image'], 'chat.png', { type: 'image/png' })

    await expect(uploadConversationImage(5, file, 1007)).resolves.toBe(
      '图片上传记录保存失败，请稍后重试'
    )
    expect(
      rateLimitMock.rollbackConversationImageUploadQuota
    ).toHaveBeenCalledWith(1007, quotaReservation)
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 1007 },
      data: { moemoepoint: { increment: 5 } }
    })
    consoleError.mockRestore()
  })
})
