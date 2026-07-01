import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user_message: {
    count: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn()
  },
  user_conversation: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn()
  },
  user_private_message: {
    updateMany: vi.fn()
  }
}))

vi.mock('~/prisma/index', () => ({
  prisma: prismaMock
}))

const verifyHeaderCookieMock = vi.hoisted(() => vi.fn())
vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: verifyHeaderCookieMock
}))

const rateLimitMock = vi.hoisted(() => ({
  checkConversationActionRateLimit: vi.fn()
}))
vi.mock('~/app/api/message/conversation/rateLimit', () => rateLimitMock)

const redisImportMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/redis', () => {
  redisImportMock()
  return {
    redis: {},
    runRedisCommand: vi.fn((command: () => unknown) => command()),
    getPrefixedRedisKey: (key: string) => `kun:touchgal:${key}`
  }
})

describe('message unread status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyHeaderCookieMock.mockResolvedValue({ uid: 1007 })
    rateLimitMock.checkConversationActionRateLimit.mockResolvedValue({
      allowed: true
    })
  })

  it('returns the message-nav unread shape from notification and conversation state', async () => {
    prismaMock.user_message.findFirst.mockResolvedValueOnce({ id: 1 })
    prismaMock.user_conversation.findFirst.mockResolvedValueOnce(null)

    const { getUnreadStatus } = await import('~/app/api/message/service')
    const result = await getUnreadStatus(1007)

    expect(result).toEqual({
      hasUnreadMessages: true,
      hasUnreadChat: false
    })
    expect(prismaMock.user_message.findFirst).toHaveBeenCalledWith({
      where: { recipient_id: 1007, status: 0 },
      select: { id: true }
    })
    expect(prismaMock.user_conversation.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            user_a_id: 1007,
            user_a_hidden: false,
            user_a_unread_count: { gt: 0 }
          },
          {
            user_b_id: 1007,
            user_b_hidden: false,
            user_b_unread_count: { gt: 0 }
          }
        ]
      },
      select: { id: true }
    })
  })

  it('returns the top-bar unread shape while preserving unread conversations after notifications are read', async () => {
    prismaMock.user_message.findFirst.mockResolvedValueOnce(null)
    prismaMock.user_conversation.findFirst.mockResolvedValueOnce({ id: 2 })

    const { getUnreadMessageStatus } = await import(
      '~/app/api/message/unread/service'
    )
    const result = await getUnreadMessageStatus(1007)

    expect(result).toEqual({
      hasUnreadNotification: false,
      hasUnreadConversation: true
    })
    expect(prismaMock.user_conversation.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            user_a_id: 1007,
            user_a_hidden: false,
            user_a_unread_count: { gt: 0 }
          },
          {
            user_b_id: 1007,
            user_b_hidden: false,
            user_b_unread_count: { gt: 0 }
          }
        ]
      },
      select: { id: true }
    })
  })

  it('marks only unread notification messages as read without changing conversation counters', async () => {
    prismaMock.user_message.findFirst.mockResolvedValueOnce({ id: 1 })

    const { readMessage } = await import('~/app/api/message/service')

    await readMessage(1007)

    expect(prismaMock.user_message.findFirst).toHaveBeenCalledWith({
      where: { recipient_id: 1007, status: 0 },
      select: { id: true }
    })
    expect(prismaMock.user_message.updateMany).toHaveBeenCalledWith({
      where: { recipient_id: 1007, status: 0 },
      data: { status: { set: 1 } }
    })
    expect(prismaMock.user_conversation.findFirst).not.toHaveBeenCalled()
  })

  it('does not write notification rows when there are no unread notifications', async () => {
    prismaMock.user_message.findFirst.mockResolvedValueOnce(null)

    const { readMessage } = await import('~/app/api/message/service')

    await readMessage(1007)

    expect(prismaMock.user_message.findFirst).toHaveBeenCalledWith({
      where: { recipient_id: 1007, status: 0 },
      select: { id: true }
    })
    expect(prismaMock.user_message.updateMany).not.toHaveBeenCalled()
  })

  it('clears all read notification messages when no concrete type is selected', async () => {
    prismaMock.user_message.findFirst.mockResolvedValueOnce({ id: 2 })

    const { clearReadMessage } = await import('~/app/api/message/service')

    await clearReadMessage(1007, '')

    expect(prismaMock.user_message.findFirst).toHaveBeenCalledWith({
      where: {
        recipient_id: 1007,
        status: 1
      },
      select: { id: true }
    })
    expect(prismaMock.user_message.deleteMany).toHaveBeenCalledWith({
      where: {
        recipient_id: 1007,
        status: 1
      }
    })
  })

  it('clears only the selected notification type when a concrete type is selected', async () => {
    prismaMock.user_message.findFirst.mockResolvedValueOnce({ id: 3 })

    const { clearReadMessage } = await import('~/app/api/message/service')

    await clearReadMessage(1007, 'system')

    expect(prismaMock.user_message.findFirst).toHaveBeenCalledWith({
      where: {
        recipient_id: 1007,
        type: 'system',
        status: 1
      },
      select: { id: true }
    })
    expect(prismaMock.user_message.deleteMany).toHaveBeenCalledWith({
      where: {
        recipient_id: 1007,
        type: 'system',
        status: 1
      }
    })
  })

  it('does not delete notification rows when no read notifications match', async () => {
    prismaMock.user_message.findFirst.mockResolvedValueOnce(null)

    const { clearReadMessage } = await import('~/app/api/message/service')

    await clearReadMessage(1007, 'system')

    expect(prismaMock.user_message.findFirst).toHaveBeenCalledWith({
      where: {
        recipient_id: 1007,
        type: 'system',
        status: 1
      },
      select: { id: true }
    })
    expect(prismaMock.user_message.deleteMany).not.toHaveBeenCalled()
  })

  it('clears all read notifications from the route when type is omitted', async () => {
    prismaMock.user_message.findFirst.mockResolvedValueOnce({ id: 4 })
    prismaMock.user_message.deleteMany.mockResolvedValueOnce({ count: 2 })

    const { DELETE } = await import('~/app/api/message/read/route')
    const response = await DELETE(
      new Request('https://www.otoame.top/api/message/read', {
        method: 'DELETE'
      }) as never
    )

    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({})
    expect(prismaMock.user_message.deleteMany).toHaveBeenCalledWith({
      where: {
        recipient_id: 1007,
        status: 1
      }
    })
  })

  it('returns unread status with private no-store cache headers', async () => {
    prismaMock.user_message.findFirst.mockResolvedValueOnce(null)
    prismaMock.user_conversation.findFirst.mockResolvedValueOnce(null)

    const { GET } = await import('~/app/api/message/unread/route')
    const response = await GET(
      new Request('https://www.otoame.top/api/message/unread') as never
    )

    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({
      hasUnreadMessages: false,
      hasUnreadChat: false
    })
  })

  it('returns 429 and avoids DB reads when notification unread sync is rate limited', async () => {
    rateLimitMock.checkConversationActionRateLimit.mockResolvedValueOnce({
      allowed: false,
      message: '通知读取过于频繁，请 7 秒后再试',
      retryAfterMs: 7_000
    })

    const { GET } = await import('~/app/api/message/unread/route')
    const response = await GET(
      new Request('https://www.otoame.top/api/message/unread') as never
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('retry-after')).toBe('7')
    await expect(response.json()).resolves.toBe(
      '通知读取过于频繁，请 7 秒后再试'
    )
    expect(rateLimitMock.checkConversationActionRateLimit).toHaveBeenCalledWith(
      'notification-read',
      1007
    )
    expect(prismaMock.user_message.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.user_conversation.findFirst).not.toHaveBeenCalled()
  })

  it('returns notification list messages with private no-store cache headers', async () => {
    prismaMock.user_message.findMany.mockResolvedValueOnce([
      {
        id: 11,
        type: 'system',
        content: '系统通知',
        status: 0,
        link: '/message-target',
        created: new Date('2026-07-01T00:00:00.000Z'),
        sender: null
      }
    ])
    prismaMock.user_message.count.mockResolvedValueOnce(1)

    const { GET } = await import('~/app/api/message/all/route')
    const response = await GET(
      new Request(
        'https://www.otoame.top/api/message/all?type=system&page=1&limit=30'
      ) as never
    )

    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toMatchObject({
      messages: [{ id: 11, type: 'system', content: '系统通知' }],
      total: 1
    })
  })

  it('returns 429 and avoids DB reads when notification list reads are rate limited', async () => {
    rateLimitMock.checkConversationActionRateLimit.mockResolvedValueOnce({
      allowed: false,
      message: '通知读取过于频繁，请 11 秒后再试',
      retryAfterMs: 11_000
    })

    const { GET } = await import('~/app/api/message/all/route')
    const response = await GET(
      new Request(
        'https://www.otoame.top/api/message/all?type=system&page=1&limit=30'
      ) as never
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('retry-after')).toBe('11')
    await expect(response.json()).resolves.toBe(
      '通知读取过于频繁，请 11 秒后再试'
    )
    expect(rateLimitMock.checkConversationActionRateLimit).toHaveBeenCalledWith(
      'notification-read',
      1007
    )
    expect(prismaMock.user_message.findMany).not.toHaveBeenCalled()
    expect(prismaMock.user_message.count).not.toHaveBeenCalled()
  })

  it('allows admins to create notification messages with private no-store cache headers', async () => {
    verifyHeaderCookieMock.mockResolvedValueOnce({ uid: 1007, role: 3 })
    prismaMock.user_message.create.mockResolvedValueOnce({
      id: 12,
      type: 'system',
      content: 'https://www.otoame.top/doc/notice',
      recipient_id: 8,
      link: '/doc/notice'
    })

    const { POST } = await import('~/app/api/message/route')
    const response = await POST(
      new Request('https://www.otoame.top/api/message', {
        method: 'POST',
        body: JSON.stringify({
          type: 'system',
          content: 'https://www.otoame.top/doc/notice',
          recipientId: 8,
          link: '/doc/notice'
        }),
        headers: { 'Content-Type': 'application/json' }
      }) as never
    )

    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toMatchObject({
      id: 12,
      type: 'system',
      recipient_id: 8
    })
  })

  it('rejects ordinary users creating arbitrary notification messages', async () => {
    verifyHeaderCookieMock.mockResolvedValueOnce({ uid: 1007, role: 1 })

    const { POST } = await import('~/app/api/message/route')
    const response = await POST(
      new Request('https://www.otoame.top/api/message', {
        method: 'POST',
        body: JSON.stringify({
          type: 'system',
          content: 'https://www.otoame.top/doc/notice',
          recipientId: 8,
          link: '/doc/notice'
        }),
        headers: { 'Content-Type': 'application/json' }
      }) as never
    )

    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toBe('权限不足')
    expect(prismaMock.user_message.create).not.toHaveBeenCalled()
  })

  it('rejects creating notification messages with the all-type sentinel', async () => {
    prismaMock.user_message.create.mockResolvedValueOnce({
      id: 13,
      type: '',
      content: 'https://www.otoame.top/doc/notice',
      recipient_id: 8,
      link: '/doc/notice'
    })

    const { POST } = await import('~/app/api/message/route')
    const response = await POST(
      new Request('https://www.otoame.top/api/message', {
        method: 'POST',
        body: JSON.stringify({
          type: '',
          content: 'https://www.otoame.top/doc/notice',
          recipientId: 8,
          link: '/doc/notice'
        }),
        headers: { 'Content-Type': 'application/json' }
      }) as never
    )

    const body = await response.json()

    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(typeof body).toBe('string')
    expect(body).toContain('type')
    expect(prismaMock.user_message.create).not.toHaveBeenCalled()
  })

  it('returns read status with private no-store cache headers', async () => {
    prismaMock.user_message.updateMany.mockResolvedValueOnce({ count: 1 })
    prismaMock.user_message.findFirst.mockResolvedValueOnce(null)
    prismaMock.user_conversation.findFirst.mockResolvedValueOnce({ id: 2 })

    const { PUT } = await import('~/app/api/message/read/route')
    const response = await PUT(
      new Request('https://www.otoame.top/api/message/read', {
        method: 'PUT'
      }) as never
    )

    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({
      hasUnreadNotification: false,
      hasUnreadConversation: true
    })
  })

  it('returns 429 and avoids DB writes when marking notifications read is rate limited', async () => {
    rateLimitMock.checkConversationActionRateLimit.mockResolvedValueOnce({
      allowed: false,
      message: '通知操作过于频繁，请 13 秒后再试',
      retryAfterMs: 13_000
    })

    const { PUT } = await import('~/app/api/message/read/route')
    const response = await PUT(
      new Request('https://www.otoame.top/api/message/read', {
        method: 'PUT'
      }) as never
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('retry-after')).toBe('13')
    await expect(response.json()).resolves.toBe(
      '通知操作过于频繁，请 13 秒后再试'
    )
    expect(rateLimitMock.checkConversationActionRateLimit).toHaveBeenCalledWith(
      'notification-write',
      1007
    )
    expect(prismaMock.user_message.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.user_message.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.user_conversation.findFirst).not.toHaveBeenCalled()
  })

  it('returns 429 and avoids DB writes when clearing read notifications is rate limited', async () => {
    rateLimitMock.checkConversationActionRateLimit.mockResolvedValueOnce({
      allowed: false,
      message: '通知操作过于频繁，请 17 秒后再试',
      retryAfterMs: 17_000
    })

    const { DELETE } = await import('~/app/api/message/read/route')
    const response = await DELETE(
      new Request('https://www.otoame.top/api/message/read?type=system', {
        method: 'DELETE'
      }) as never
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('retry-after')).toBe('17')
    await expect(response.json()).resolves.toBe(
      '通知操作过于频繁，请 17 秒后再试'
    )
    expect(rateLimitMock.checkConversationActionRateLimit).toHaveBeenCalledWith(
      'notification-write',
      1007
    )
    expect(prismaMock.user_message.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.user_message.deleteMany).not.toHaveBeenCalled()
  })

  it('returns conversation read status with private no-store cache headers', async () => {
    prismaMock.user_conversation.findUnique.mockResolvedValueOnce({
      id: 5,
      user_a_id: 1007,
      user_b_id: 8
    })
    prismaMock.user_private_message.updateMany.mockResolvedValueOnce({
      count: 1
    })
    prismaMock.user_conversation.update.mockResolvedValueOnce({ id: 5 })
    prismaMock.user_message.findFirst.mockResolvedValueOnce({ id: 1 })
    prismaMock.user_conversation.findFirst.mockResolvedValueOnce(null)

    const { PUT } = await import(
      '~/app/api/message/conversation/[id]/read/route'
    )
    expect(redisImportMock).not.toHaveBeenCalled()

    const response = await PUT(
      new Request('https://www.otoame.top/api/message/conversation/5/read', {
        method: 'PUT'
      }) as never,
      { params: Promise.resolve({ id: '5' }) }
    )

    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({
      hasUnreadNotification: true,
      hasUnreadConversation: false
    })
    expect(rateLimitMock.checkConversationActionRateLimit).toHaveBeenCalledWith(
      'message-read',
      1007
    )
  })

  it('rejects malformed conversation read route IDs before auth or DB work', async () => {
    const { PUT } = await import(
      '~/app/api/message/conversation/[id]/read/route'
    )

    const response = await PUT(
      new Request(
        'https://www.otoame.top/api/message/conversation/5abc/read',
        { method: 'PUT' }
      ) as never,
      { params: Promise.resolve({ id: '5abc' }) }
    )

    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toBe('无效的会话 ID')
    expect(verifyHeaderCookieMock).not.toHaveBeenCalled()
    expect(prismaMock.user_conversation.findUnique).not.toHaveBeenCalled()
  })

  it('returns 429 and avoids DB work when conversation read sync is rate limited', async () => {
    rateLimitMock.checkConversationActionRateLimit.mockResolvedValueOnce({
      allowed: false,
      message: '消息读取过于频繁，请 9 秒后再试',
      retryAfterMs: 9_000
    })

    const { PUT } = await import(
      '~/app/api/message/conversation/[id]/read/route'
    )

    const response = await PUT(
      new Request('https://www.otoame.top/api/message/conversation/5/read', {
        method: 'PUT'
      }) as never,
      { params: Promise.resolve({ id: '5' }) }
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('retry-after')).toBe('9')
    await expect(response.json()).resolves.toBe(
      '消息读取过于频繁，请 9 秒后再试'
    )
    expect(rateLimitMock.checkConversationActionRateLimit).toHaveBeenCalledWith(
      'message-read',
      1007
    )
    expect(prismaMock.user_conversation.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.user_message.findFirst).not.toHaveBeenCalled()
  })

  it('does not write when a conversation is already read for the current user', async () => {
    prismaMock.user_conversation.findUnique.mockResolvedValueOnce({
      id: 5,
      user_a_id: 1007,
      user_b_id: 8,
      user_a_unread_count: 0,
      user_b_unread_count: 2
    })

    const { markConversationAsRead } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    const result = await markConversationAsRead(5, 1007)

    expect(result).toEqual({})
    expect(prismaMock.user_private_message.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.user_conversation.update).not.toHaveBeenCalled()
  })
})
