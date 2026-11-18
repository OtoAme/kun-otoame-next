import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
  user: { findUnique: vi.fn() },
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
vi.mock('~/app/api/utils/sessionIdentity', () => ({
  getRequestIdentity: async (request: Request) => {
    const payload = await verifyHeaderCookieMock(request)
    return payload ? { status: 'authenticated', payload } : { status: 'guest' }
  }
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

const summaryMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/message/notificationQuery', async () => ({
  notificationCategorySql: (await import('@prisma/client')).Prisma.empty,
  readNotificationSummary: summaryMock
}))
vi.mock('~/app/api/utils/message', async (original) => ({
  ...(await original<typeof import('~/app/api/utils/message')>()),
  createMessage: (data: unknown) => prismaMock.user_message.create({ data })
}))
const notificationSummary = (unread = 0) => ({
  unread,
  sequence: '90',
  categories: Object.fromEntries(
    ['interaction', 'help', 'review', 'maintenance', 'account'].map(
      (category) => [
        category,
        {
          unread: category === 'account' ? unread : 0,
          sequence: category === 'account' ? '90' : '0'
        }
      ]
    )
  )
})

describe('message unread status', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    summaryMock.mockResolvedValue(notificationSummary())
    prismaMock.$transaction.mockImplementation(async (action) =>
      action(prismaMock)
    )
    prismaMock.$queryRaw.mockImplementation(async (query) => {
      const sql = query.sql ?? query.join('')
      if (sql.includes('max(id)')) return [{ maximum: 11 }]
      if (sql.includes('count(*)')) return [{ amount: 1 }]
      return [{ id: sql.includes('user_message') ? 11 : 1007 }]
    })
    prismaMock.$executeRaw.mockResolvedValue(2)
    prismaMock.user_message.findMany.mockResolvedValue([])
    prismaMock.user_message.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.user_conversation.findFirst.mockResolvedValue(null)
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1007,
      preference_version: 3
    })
    verifyHeaderCookieMock.mockResolvedValue({ uid: 1007 })
    rateLimitMock.checkConversationActionRateLimit.mockResolvedValue({
      allowed: true
    })
  })

  it('returns the message-nav unread shape from notification and conversation state', async () => {
    summaryMock.mockResolvedValueOnce(notificationSummary(1))
    prismaMock.user_conversation.findFirst.mockResolvedValueOnce(null)

    const { getUnreadStatus } = await import('~/app/api/message/service')
    const result = await getUnreadStatus(1007)

    expect(result).toMatchObject({
      preferenceVersion: 3,
      hasUnreadMessages: true,
      hasUnreadChat: false
    })
    expect(summaryMock).toHaveBeenCalledWith(prismaMock, 1007)
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

    expect(result).toMatchObject({
      preferenceVersion: 3,
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

  it('rejects unscoped confirmation without changing either message channel', async () => {
    const { readMessage } = await import('~/app/api/message/service')
    expect(await readMessage(1007)).toMatchObject({
      code: 'NOTIFICATION_SCOPE_REQUIRED'
    })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.user_message.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.user_private_message.updateMany).not.toHaveBeenCalled()
  })

  it('does not write when the requested concrete message is unavailable', async () => {
    const { readMessage } = await import('~/app/api/message/service')
    expect(
      await readMessage(1007, { items: [{ id: 11, version: '1' }] })
    ).toMatchObject({ results: [{ id: 11, outcome: 'missing' }] })
    expect(prismaMock.user_message.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.user_private_message.updateMany).not.toHaveBeenCalled()
  })

  it('locks and deletes only the current recipients read rows', async () => {
    const { clearReadMessage } = await import('~/app/api/message/service')
    expect(await clearReadMessage(1007, '')).toMatchObject({ deleted: 2 })
    const deletion = prismaMock.$executeRaw.mock.calls[0][0]
    expect(deletion.sql).toContain('DELETE FROM user_message WHERE')
    expect(deletion.sql).toContain('status =')
    expect(deletion.sql).toContain('id = ANY(')
    expect(deletion.values).toEqual([1007, 1, [11]])
    expect(prismaMock.user_private_message.updateMany).not.toHaveBeenCalled()
  })

  it('keeps concrete type and category in both cleanup lock and deletion predicates', async () => {
    const { clearReadMessage } = await import('~/app/api/message/service')
    await clearReadMessage(1007, 'system', 'account')
    const locked = prismaMock.$queryRaw.mock.calls[1][0]
    const deleted = prismaMock.$executeRaw.mock.calls[0][0]
    expect(locked.sql).toContain('ORDER BY id FOR UPDATE')
    expect(locked.values).toEqual([1007, 'system', 'account', 1])
    expect(deleted.values).toEqual([1007, 'system', 'account', 1, [11]])
  })

  it('does not delete anything if the locked cleanup collection is empty', async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ id: 1007 }])
      .mockResolvedValueOnce([])
    const { clearReadMessage } = await import('~/app/api/message/service')
    expect(await clearReadMessage(1007, 'system')).toMatchObject({ deleted: 0 })
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled()
  })

  it('returns cleanup results and a fresh summary with private cache headers', async () => {
    const { DELETE } = await import('~/app/api/message/read/route')
    const response = await DELETE(
      new Request('https://example.test/api/message/read', {
        method: 'DELETE'
      }) as never
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toMatchObject({
      deleted: 2,
      summary: { notifications: notificationSummary() }
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
    expect(await response.json()).toMatchObject({
      preferenceVersion: 3,
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
        content_version: 1n,
        event_type: null,
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
      id: 12
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

  it('returns concrete confirmation results and independent conversation state', async () => {
    prismaMock.user_message.findMany.mockResolvedValueOnce([
      { id: 11, content_version: 1n, status: 0, updated: new Date(0) }
    ])
    prismaMock.user_conversation.findFirst.mockResolvedValueOnce({ id: 2 })
    const { PUT } = await import('~/app/api/message/read/route')
    const response = await PUT(
      new Request('https://example.test/api/message/read', {
        method: 'PUT',
        body: JSON.stringify({ items: [{ id: 11, version: '1' }] }),
        headers: { 'Content-Type': 'application/json' }
      }) as never
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toMatchObject({
      results: [{ id: 11, outcome: 'read' }],
      summary: {
        preferenceVersion: 3,
        hasUnreadNotification: false,
        hasUnreadConversation: true
      }
    })
    expect(prismaMock.user_message.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: 11, recipient_id: 1007, status: 0, content_version: 1n },
      data: { status: 1, updated: new Date(0) }
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
        method: 'PUT',
        body: JSON.stringify({ items: [{ id: 11, version: '1' }] }),
        headers: { 'Content-Type': 'application/json' }
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
    summaryMock.mockResolvedValueOnce(notificationSummary(1))
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
    expect(await response.json()).toMatchObject({
      preferenceVersion: 3,
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
      new Request('https://www.otoame.top/api/message/conversation/5abc/read', {
        method: 'PUT'
      }) as never,
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
