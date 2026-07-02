import { beforeEach, describe, expect, it, vi } from 'vitest'

const redisMock = vi.hoisted(() => ({
  eval: vi.fn()
}))

const redisCommandMock = vi.hoisted(() => ({
  runRedisCommand: vi.fn((command: () => Promise<unknown>) => command())
}))

vi.mock('~/lib/redis', () => ({
  redis: redisMock,
  runRedisCommand: redisCommandMock.runRedisCommand,
  getPrefixedRedisKey: (key: string) => `kun:touchgal:${key}`
}))

describe('conversation rate limit helper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows requests under the private chat send limit', async () => {
    redisMock.eval.mockResolvedValue(
      JSON.stringify({ allowed: true, remaining: 29 })
    )

    const { checkConversationActionRateLimit } = await import(
      '~/app/api/message/conversation/rateLimit'
    )
    const result = await checkConversationActionRateLimit('send', 1007)

    expect(result).toEqual({ allowed: true })
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining('INCR'),
      1,
      'kun:touchgal:conversation:rate-limit:send:1007',
      '60',
      '30'
    )
  })

  it('returns a retry message when private chat image uploads exceed the limit', async () => {
    redisMock.eval.mockResolvedValue(
      JSON.stringify({ allowed: false, retryAfterMs: 61_000 })
    )

    const { checkConversationActionRateLimit } = await import(
      '~/app/api/message/conversation/rateLimit'
    )
    const result = await checkConversationActionRateLimit(
      'image-upload',
      1007
    )

    expect(result).toEqual({
      allowed: false,
      retryAfterMs: 61_000,
      message: '图片上传过于频繁，请 61 秒后再试'
    })
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining('PTTL'),
      1,
      'kun:touchgal:conversation:rate-limit:image-upload:1007',
      '300',
      '10'
    )
  })

  it('limits private chat image upload intake before multipart parsing', async () => {
    redisMock.eval.mockResolvedValue(
      JSON.stringify({ allowed: false, retryAfterMs: 20_000 })
    )

    const { checkConversationActionRateLimit } = await import(
      '~/app/api/message/conversation/rateLimit'
    )
    const result = await checkConversationActionRateLimit(
      'image-upload-intake' as never,
      1007
    )

    expect(result).toEqual({
      allowed: false,
      retryAfterMs: 20_000,
      message: '图片上传请求过于频繁，请 20 秒后再试'
    })
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining('PTTL'),
      1,
      'kun:touchgal:conversation:rate-limit:image-upload-intake:1007',
      '60',
      '30'
    )
  })

  it('limits private chat check and open attempts per user', async () => {
    redisMock.eval.mockResolvedValue(
      JSON.stringify({ allowed: false, retryAfterMs: 45_000 })
    )

    const { checkConversationActionRateLimit } = await import(
      '~/app/api/message/conversation/rateLimit'
    )
    const result = await checkConversationActionRateLimit(
      'conversation-open',
      1007
    )

    expect(result).toEqual({
      allowed: false,
      retryAfterMs: 45_000,
      message: '私聊操作过于频繁，请 45 秒后再试'
    })
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining('PTTL'),
      1,
      'kun:touchgal:conversation:rate-limit:conversation-open:1007',
      '60',
      '60'
    )
  })

  it('limits private chat message reads per user without scoping by conversation', async () => {
    redisMock.eval.mockResolvedValue(
      JSON.stringify({ allowed: false, retryAfterMs: 12_000 })
    )

    const { checkConversationActionRateLimit } = await import(
      '~/app/api/message/conversation/rateLimit'
    )
    const result = await checkConversationActionRateLimit('message-read', 1007)

    expect(result).toEqual({
      allowed: false,
      retryAfterMs: 12_000,
      message: '消息读取过于频繁，请 12 秒后再试'
    })
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining('PTTL'),
      1,
      'kun:touchgal:conversation:rate-limit:message-read:1007',
      '60',
      '180'
    )
  })

  it('limits private chat message edit and delete writes per user', async () => {
    redisMock.eval.mockResolvedValue(
      JSON.stringify({ allowed: false, retryAfterMs: 9_000 })
    )

    const { checkConversationActionRateLimit } = await import(
      '~/app/api/message/conversation/rateLimit'
    )
    const result = await checkConversationActionRateLimit(
      'message-write' as never,
      1007
    )

    expect(result).toEqual({
      allowed: false,
      retryAfterMs: 9_000,
      message: '消息操作过于频繁，请 9 秒后再试'
    })
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining('PTTL'),
      1,
      'kun:touchgal:conversation:rate-limit:message-write:1007',
      '60',
      '60'
    )
  })

  it('limits notification list and unread reads per user', async () => {
    redisMock.eval.mockResolvedValue(
      JSON.stringify({ allowed: false, retryAfterMs: 8_000 })
    )

    const { checkConversationActionRateLimit } = await import(
      '~/app/api/message/conversation/rateLimit'
    )
    const result = await checkConversationActionRateLimit(
      'notification-read' as never,
      1007
    )

    expect(result).toEqual({
      allowed: false,
      retryAfterMs: 8_000,
      message: '通知读取过于频繁，请 8 秒后再试'
    })
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining('PTTL'),
      1,
      'kun:touchgal:conversation:rate-limit:notification-read:1007',
      '60',
      '180'
    )
  })

  it('limits notification read/clear writes per user', async () => {
    redisMock.eval.mockResolvedValue(
      JSON.stringify({ allowed: false, retryAfterMs: 14_000 })
    )

    const { checkConversationActionRateLimit } = await import(
      '~/app/api/message/conversation/rateLimit'
    )
    const result = await checkConversationActionRateLimit(
      'notification-write' as never,
      1007
    )

    expect(result).toEqual({
      allowed: false,
      retryAfterMs: 14_000,
      message: '通知操作过于频繁，请 14 秒后再试'
    })
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining('PTTL'),
      1,
      'kun:touchgal:conversation:rate-limit:notification-write:1007',
      '60',
      '30'
    )
  })

  it('limits private chat conversation management writes per user', async () => {
    redisMock.eval.mockResolvedValue(
      JSON.stringify({ allowed: false, retryAfterMs: 15_000 })
    )

    const { checkConversationActionRateLimit } = await import(
      '~/app/api/message/conversation/rateLimit'
    )
    const result = await checkConversationActionRateLimit(
      'conversation-manage' as never,
      1007
    )

    expect(result).toEqual({
      allowed: false,
      retryAfterMs: 15_000,
      message: '私聊管理操作过于频繁，请 15 秒后再试'
    })
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining('PTTL'),
      1,
      'kun:touchgal:conversation:rate-limit:conversation-manage:1007',
      '60',
      '30'
    )
  })

  it('fails open when Redis cannot check the private chat rate limit', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    redisMock.eval.mockRejectedValue(new Error('redis unavailable'))

    const { checkConversationActionRateLimit } = await import(
      '~/app/api/message/conversation/rateLimit'
    )
    const result = await checkConversationActionRateLimit('send', 1007)

    expect(result).toEqual({ allowed: true })
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to check conversation rate limit',
      expect.objectContaining({
        action: 'send',
        uid: 1007
      })
    )
    consoleError.mockRestore()
  })

  it('reserves the hourly free private chat image upload quota without cost', async () => {
    redisMock.eval.mockResolvedValue(
      JSON.stringify({ count: 5, ttlSeconds: 1800 })
    )

    const { consumeConversationImageUploadQuota } = await import(
      '~/app/api/message/conversation/rateLimit'
    )
    const result = await consumeConversationImageUploadQuota(1007)

    expect(result).toEqual({
      counted: true,
      count: 5,
      cost: 0,
      ttlSeconds: 1800
    })
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining('INCR'),
      1,
      'kun:touchgal:conversation:image-upload-quota:1007',
      '3600'
    )
  })

  it('charges moemoepoints after the hourly free private chat image upload quota', async () => {
    redisMock.eval.mockResolvedValue(
      JSON.stringify({ count: 6, ttlSeconds: 1700 })
    )

    const { consumeConversationImageUploadQuota } = await import(
      '~/app/api/message/conversation/rateLimit'
    )
    const result = await consumeConversationImageUploadQuota(1007)

    expect(result).toMatchObject({
      counted: true,
      count: 6,
      cost: 5,
      ttlSeconds: 1700
    })
  })

  it('rolls back a reserved hourly private chat image upload quota slot', async () => {
    const { rollbackConversationImageUploadQuota } = await import(
      '~/app/api/message/conversation/rateLimit'
    )

    await rollbackConversationImageUploadQuota(1007, {
      counted: true,
      count: 6,
      cost: 5,
      ttlSeconds: 1700
    })

    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining('DECR'),
      1,
      'kun:touchgal:conversation:image-upload-quota:1007'
    )
  })

  it('returns unavailable when Redis cannot reserve the private chat image upload quota', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    redisMock.eval.mockRejectedValue(new Error('redis unavailable'))

    const { consumeConversationImageUploadQuota } = await import(
      '~/app/api/message/conversation/rateLimit'
    )
    const result = await consumeConversationImageUploadQuota(1007)

    expect(result).toEqual({
      counted: false,
      count: 0,
      cost: 0,
      ttlSeconds: 0,
      unavailable: true
    })
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to consume conversation image upload quota',
      expect.objectContaining({ uid: 1007 })
    )
    consoleError.mockRestore()
  })
})
