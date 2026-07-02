import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn()
  },
  user_conversation: {
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn()
  },
  user_private_message: {
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn()
  },
  _tx: {
    user_private_message: {
      create: vi.fn()
    },
    user_conversation: {
      update: vi.fn()
    }
  },
  $transaction: vi.fn(),
  $queryRaw: vi.fn()
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

describe('conversation message fetching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitMock.checkConversationActionRateLimit.mockReset()
    verifyHeaderCookieMock.mockResolvedValue({ uid: 1007 })
    rateLimitMock.checkConversationActionRateLimit.mockResolvedValue({
      allowed: true
    })
    prismaMock.user.findUnique.mockResolvedValue({
      id: 8,
      allow_private_message: true
    })
    prismaMock.user_conversation.findUnique.mockResolvedValue({
      id: 5,
      user_a_id: 1007,
      user_b_id: 8,
      user_a: { id: 1007, name: 'Saya', avatar: '/saya.webp' },
      user_b: { id: 8, name: 'Mio', avatar: '/mio.webp' }
    })
    prismaMock.user_private_message.count.mockResolvedValue(3)
    prismaMock.$transaction.mockImplementation(async (fn) => fn(prismaMock._tx))
  })

  it('returns only messages newer than afterId without counting full history', async () => {
    const newerMessages = [
      {
        id: 11,
        content: 'newest',
        status: 0,
        is_deleted: false,
        edited_at: null,
        created: new Date('2026-06-29T10:02:00.000Z'),
        sender: { id: 8, name: 'Mio', avatar: '/mio.webp' }
      },
      {
        id: 10,
        content: 'new',
        status: 0,
        is_deleted: false,
        edited_at: null,
        created: new Date('2026-06-29T10:01:00.000Z'),
        sender: { id: 8, name: 'Mio', avatar: '/mio.webp' }
      }
    ]
    prismaMock.user_private_message.findMany.mockResolvedValue(newerMessages)

    const { getConversationMessages } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    const result = await getConversationMessages(
      5,
      { page: 1, limit: 50, afterId: 9 },
      1007
    )

    expect(prismaMock.user_private_message.findMany).toHaveBeenCalledWith({
      where: { conversation_id: 5, id: { gt: 9 } },
      include: {
        sender: {
          select: { id: true, name: true, avatar: true }
        }
      },
      orderBy: { created: 'asc' },
      take: 50
    })
    expect(prismaMock.user_private_message.count).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      total: 2,
      otherUser: { id: 8, name: 'Mio', avatar: '/mio.webp' },
      messages: [
        { id: 10, content: 'new' },
        { id: 11, content: 'newest' }
      ]
    })
  })

  it('preserves existing paginated history query without afterId', async () => {
    prismaMock.user_private_message.findMany.mockResolvedValue([])

    const { getConversationMessages } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    await getConversationMessages(5, { page: 2, limit: 30 }, 1007)

    expect(prismaMock.user_private_message.findMany).toHaveBeenCalledWith({
      where: { conversation_id: 5 },
      include: {
        sender: {
          select: { id: true, name: true, avatar: true }
        }
      },
      orderBy: { created: 'desc' },
      skip: 30,
      take: 30
    })
    expect(prismaMock.user_private_message.count).toHaveBeenCalledWith({
      where: { conversation_id: 5 }
    })
  })

  it('returns the initial message page in chronological order', async () => {
    prismaMock.user_private_message.findMany.mockResolvedValue([
      {
        id: 12,
        type: 0,
        content: 'newer',
        status: 0,
        is_deleted: false,
        edited_at: null,
        image_url: null,
        image_width: null,
        image_height: null,
        image_size: null,
        image_mime: null,
        image_name: null,
        reply_to_message_id: null,
        reply_preview_content: null,
        reply_preview_sender_name: null,
        reply_selected_text: null,
        created: new Date('2026-06-30T10:02:00.000Z'),
        sender: { id: 8, name: 'Mio', avatar: '/mio.webp' }
      },
      {
        id: 11,
        type: 0,
        content: 'older',
        status: 0,
        is_deleted: false,
        edited_at: null,
        image_url: null,
        image_width: null,
        image_height: null,
        image_size: null,
        image_mime: null,
        image_name: null,
        reply_to_message_id: null,
        reply_preview_content: null,
        reply_preview_sender_name: null,
        reply_selected_text: null,
        created: new Date('2026-06-30T10:01:00.000Z'),
        sender: { id: 8, name: 'Mio', avatar: '/mio.webp' }
      }
    ])

    const { getConversationMessages } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    const result = await getConversationMessages(
      5,
      { page: 1, limit: 30 },
      1007
    )

    expect(result).toMatchObject({
      messages: [
        { id: 11, content: 'older' },
        { id: 12, content: 'newer' }
      ]
    })
  })

  it('loads older messages with beforeId without skip or full count', async () => {
    prismaMock.user_private_message.findMany.mockResolvedValue([
      {
        id: 4,
        type: 0,
        content: 'older',
        status: 0,
        is_deleted: false,
        edited_at: null,
        image_url: null,
        image_width: null,
        image_height: null,
        image_size: null,
        image_mime: null,
        image_name: null,
        reply_to_message_id: null,
        reply_preview_content: null,
        reply_preview_sender_name: null,
        reply_selected_text: null,
        created: new Date('2026-06-30T09:00:00.000Z'),
        sender: { id: 8, name: 'Mio', avatar: '/mio.webp' }
      }
    ])

    const { getConversationMessages } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    const result = await getConversationMessages(
      5,
      { page: 1, limit: 30, beforeId: 9 },
      1007
    )

    expect(prismaMock.user_private_message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversation_id: 5, id: { lt: 9 } },
        orderBy: { id: 'desc' },
        take: 31
      })
    )
    expect(prismaMock.user_private_message.count).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      messages: [{ id: 4, content: 'older' }],
      hasMoreBefore: false
    })
  })

  it('returns image and reply metadata for mapped messages', async () => {
    prismaMock.user_private_message.findMany.mockResolvedValue([
      {
        id: 20,
        type: 1,
        content: 'caption',
        status: 1,
        is_deleted: false,
        edited_at: null,
        image_url: 'https://img.example/chat.webp',
        image_width: 800,
        image_height: 600,
        image_size: 12345,
        image_mime: 'image/webp',
        image_name: 'chat.webp',
        reply_to_message_id: 10,
        reply_preview_content: 'quoted text',
        reply_preview_sender_name: 'Mio',
        reply_selected_text: 'quoted',
        reply_image: {
          url: 'https://img.example/quoted.webp',
          width: 240,
          height: 180,
          size: 123,
          mime: 'image/webp',
          name: 'quoted.webp'
        },
        created: new Date('2026-06-30T10:00:00.000Z'),
        sender: { id: 1007, name: 'Saya', avatar: '/saya.webp' }
      }
    ])

    const { getConversationMessages } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    const result = await getConversationMessages(
      5,
      { page: 1, limit: 30 },
      1007
    )

    expect(result).toMatchObject({
      messages: [
        {
          id: 20,
          type: 1,
          content: 'caption',
          image: {
            url: 'https://img.example/chat.webp',
            width: 800,
            height: 600,
            size: 12345,
            mime: 'image/webp',
            name: 'chat.webp'
          },
          replyTo: {
            messageId: 10,
            content: 'quoted text',
            senderName: 'Mio',
            selectedText: 'quoted',
            image: {
              url: 'https://img.example/quoted.webp',
              width: 240,
              height: 180,
              size: 123,
              mime: 'image/webp',
              name: 'quoted.webp'
            }
          }
        }
      ]
    })
  })

  it('normalizes corrupted image messages without image metadata to a text placeholder', async () => {
    prismaMock.user_private_message.findMany.mockResolvedValue([
      {
        id: 22,
        type: 1,
        content: '',
        status: 1,
        is_deleted: false,
        edited_at: null,
        image_url: null,
        image_width: null,
        image_height: null,
        image_size: null,
        image_mime: null,
        image_name: null,
        image_group: [{ url: 'not-a-complete-image' }],
        reply_to_message_id: null,
        reply_preview_content: null,
        reply_preview_sender_name: null,
        reply_selected_text: null,
        reply_image: null,
        created: new Date('2026-06-30T10:00:00.000Z'),
        sender: { id: 1007, name: 'Saya', avatar: '/saya.webp' }
      }
    ])

    const { getConversationMessages } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    const result = await getConversationMessages(
      5,
      { page: 1, limit: 30 },
      1007
    )

    expect(result).toMatchObject({
      messages: [
        {
          id: 22,
          type: 0,
          content: '[图片不可用]',
          image: null,
          images: [],
          replyTo: null
        }
      ]
    })
  })

  it('does not expose deleted private message content or media metadata', async () => {
    prismaMock.user_private_message.findMany.mockResolvedValue([
      {
        id: 21,
        type: 1,
        content: 'private deleted caption',
        status: 0,
        is_deleted: true,
        edited_at: null,
        image_url: 'https://img.example/private-deleted.webp',
        image_width: 800,
        image_height: 600,
        image_size: 12345,
        image_mime: 'image/webp',
        image_name: 'private-deleted.webp',
        image_group: [
          {
            url: 'https://img.example/private-deleted.webp',
            width: 800,
            height: 600,
            size: 12345,
            mime: 'image/webp',
            name: 'private-deleted.webp'
          }
        ],
        reply_to_message_id: 10,
        reply_preview_content: 'quoted private text',
        reply_preview_sender_name: 'Mio',
        reply_selected_text: 'quoted private text',
        reply_image: {
          url: 'https://img.example/quoted-private.webp',
          width: 240,
          height: 180,
          size: 123,
          mime: 'image/webp',
          name: 'quoted-private.webp'
        },
        created: new Date('2026-06-30T10:00:00.000Z'),
        sender: { id: 1007, name: 'Saya', avatar: '/saya.webp' }
      }
    ])

    const { getConversationMessages } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    const result = await getConversationMessages(
      5,
      { page: 1, limit: 30 },
      1007
    )

    expect(result).toMatchObject({
      messages: [
        {
          id: 21,
          type: 0,
          content: '',
          isDeleted: true,
          image: null,
          images: [],
          replyTo: null
        }
      ]
    })
    expect(JSON.stringify(result)).not.toContain('private deleted caption')
    expect(JSON.stringify(result)).not.toContain('private-deleted.webp')
    expect(JSON.stringify(result)).not.toContain('quoted private text')
  })

  it('returns personalized conversation messages with no-store cache headers', async () => {
    prismaMock.user_private_message.findMany.mockResolvedValue([])

    const { GET } = await import('~/app/api/message/conversation/[id]/route')
    const response = await GET(
      new Request(
        'https://www.otoame.top/api/message/conversation/5?page=1&limit=30'
      ) as never,
      { params: Promise.resolve({ id: '5' }) }
    )

    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toMatchObject({
      messages: [],
      total: 3,
      otherUser: { id: 8, name: 'Mio', avatar: '/mio.webp' }
    })
  })

  it('rejects malformed conversation route IDs before auth or DB work', async () => {
    const { GET } = await import('~/app/api/message/conversation/[id]/route')
    const response = await GET(
      new Request(
        'https://www.otoame.top/api/message/conversation/5abc?page=1&limit=30'
      ) as never,
      { params: Promise.resolve({ id: '5abc' }) }
    )

    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toBe('无效的会话 ID')
    expect(verifyHeaderCookieMock).not.toHaveBeenCalled()
    expect(prismaMock.user_conversation.findUnique).not.toHaveBeenCalled()
  })

  it('returns no-store cache headers when sending private messages', async () => {
    prismaMock._tx.user_private_message.create.mockResolvedValue({
      id: 30,
      type: 0,
      content: 'hello',
      status: 0,
      is_deleted: false,
      edited_at: null,
      image_url: null,
      image_width: null,
      image_height: null,
      image_size: null,
      image_mime: null,
      image_name: null,
      reply_to_message_id: null,
      reply_preview_content: null,
      reply_preview_sender_name: null,
      reply_selected_text: null,
      created: new Date('2026-06-30T10:00:00.000Z'),
      sender: { id: 1007, name: 'Saya', avatar: '/saya.webp' }
    })

    const { POST } = await import('~/app/api/message/conversation/[id]/route')
    const response = await POST(
      new Request('https://www.otoame.top/api/message/conversation/5', {
        method: 'POST',
        body: JSON.stringify({ type: 0, content: 'hello' }),
        headers: { 'Content-Type': 'application/json' }
      }) as never,
      { params: Promise.resolve({ id: '5' }) }
    )

    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toMatchObject({
      id: 30,
      content: 'hello'
    })
  })

  it('returns 429 with retry-after when sending private messages is rate limited', async () => {
    rateLimitMock.checkConversationActionRateLimit.mockResolvedValueOnce({
      allowed: false,
      message: '发送过于频繁，请 31 秒后再试',
      retryAfterMs: 30_500
    })

    const { POST } = await import('~/app/api/message/conversation/[id]/route')
    const response = await POST(
      new Request('https://www.otoame.top/api/message/conversation/5', {
        method: 'POST',
        body: JSON.stringify({ type: 0, content: 'hello' }),
        headers: { 'Content-Type': 'application/json' }
      }) as never,
      { params: Promise.resolve({ id: '5' }) }
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('retry-after')).toBe('31')
    await expect(response.json()).resolves.toBe('发送过于频繁，请 31 秒后再试')
    expect(prismaMock._tx.user_private_message.create).not.toHaveBeenCalled()
  })

  it('returns 429 and avoids message reads when editing private messages is rate limited', async () => {
    rateLimitMock.checkConversationActionRateLimit.mockResolvedValueOnce({
      allowed: false,
      message: '消息操作过于频繁，请 9 秒后再试',
      retryAfterMs: 9_000
    })

    const { PUT } = await import('~/app/api/message/conversation/[id]/route')
    const response = await PUT(
      new Request('https://www.otoame.top/api/message/conversation/5', {
        method: 'PUT',
        body: JSON.stringify({ messageId: 12, content: 'updated' }),
        headers: { 'Content-Type': 'application/json' }
      }) as never,
      { params: Promise.resolve({ id: '5' }) }
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('retry-after')).toBe('9')
    await expect(response.json()).resolves.toBe(
      '消息操作过于频繁，请 9 秒后再试'
    )
    expect(rateLimitMock.checkConversationActionRateLimit).toHaveBeenCalledWith(
      'message-write',
      1007
    )
    expect(prismaMock.user_private_message.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.user_private_message.update).not.toHaveBeenCalled()
  })

  it('returns 429 and avoids message reads when deleting private messages is rate limited', async () => {
    rateLimitMock.checkConversationActionRateLimit.mockResolvedValueOnce({
      allowed: false,
      message: '消息操作过于频繁，请 9 秒后再试',
      retryAfterMs: 9_000
    })

    const { DELETE } = await import(
      '~/app/api/message/conversation/[id]/route'
    )
    const response = await DELETE(
      new Request(
        'https://www.otoame.top/api/message/conversation/5?messageId=12',
        { method: 'DELETE' }
      ) as never,
      { params: Promise.resolve({ id: '5' }) }
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('retry-after')).toBe('9')
    await expect(response.json()).resolves.toBe(
      '消息操作过于频繁，请 9 秒后再试'
    )
    expect(rateLimitMock.checkConversationActionRateLimit).toHaveBeenCalledWith(
      'message-write',
      1007
    )
    expect(prismaMock.user_private_message.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.user_private_message.update).not.toHaveBeenCalled()
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
  })

  it('returns 429 and avoids DB reads when removing a conversation is rate limited', async () => {
    rateLimitMock.checkConversationActionRateLimit.mockResolvedValueOnce({
      allowed: false,
      message: '私聊管理操作过于频繁，请 15 秒后再试',
      retryAfterMs: 15_000
    })

    const { DELETE } = await import(
      '~/app/api/message/conversation/[id]/route'
    )
    const response = await DELETE(
      new Request(
        'https://www.otoame.top/api/message/conversation/5?action=conversation',
        { method: 'DELETE' }
      ) as never,
      { params: Promise.resolve({ id: '5' }) }
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('retry-after')).toBe('15')
    await expect(response.json()).resolves.toBe(
      '私聊管理操作过于频繁，请 15 秒后再试'
    )
    expect(rateLimitMock.checkConversationActionRateLimit).toHaveBeenCalledWith(
      'conversation-manage',
      1007
    )
    expect(prismaMock.user_conversation.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.user_conversation.update).not.toHaveBeenCalled()
  })

  it('removes a conversation with a single management rate-limit check', async () => {
    const { DELETE } = await import(
      '~/app/api/message/conversation/[id]/route'
    )
    const response = await DELETE(
      new Request(
        'https://www.otoame.top/api/message/conversation/5?action=conversation',
        { method: 'DELETE' }
      ) as never,
      { params: Promise.resolve({ id: '5' }) }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({})
    expect(rateLimitMock.checkConversationActionRateLimit).toHaveBeenCalledTimes(
      1
    )
    expect(rateLimitMock.checkConversationActionRateLimit).toHaveBeenCalledWith(
      'conversation-manage',
      1007
    )
    expect(prismaMock.user_conversation.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: {
        user_a_hidden: true,
        user_a_unread_count: 0
      }
    })
  })

  it('returns 429 and avoids DB reads when private chat message reads are rate limited', async () => {
    rateLimitMock.checkConversationActionRateLimit.mockResolvedValueOnce({
      allowed: false,
      message: '消息读取过于频繁，请 12 秒后再试',
      retryAfterMs: 12_000
    })

    const { GET } = await import('~/app/api/message/conversation/[id]/route')
    const response = await GET(
      new Request(
        'https://www.otoame.top/api/message/conversation/5?page=1&limit=30'
      ) as never,
      { params: Promise.resolve({ id: '5' }) }
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('retry-after')).toBe('12')
    await expect(response.json()).resolves.toBe(
      '消息读取过于频繁，请 12 秒后再试'
    )
    expect(rateLimitMock.checkConversationActionRateLimit).toHaveBeenCalledWith(
      'message-read',
      1007
    )
    expect(prismaMock.user_conversation.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.user_private_message.findMany).not.toHaveBeenCalled()
    expect(prismaMock.user_private_message.count).not.toHaveBeenCalled()
  })

  it('returns personalized conversation list with no-store cache headers', async () => {
    prismaMock.user_conversation.findMany.mockResolvedValue([])
    prismaMock.user_conversation.count.mockResolvedValue(0)

    const { GET } = await import('~/app/api/message/conversation/route')
    const response = await GET(
      new Request(
        'https://www.otoame.top/api/message/conversation?page=1&limit=30'
      ) as never
    )

    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({
      conversations: [],
      total: 0
    })
  })

  it('returns 429 and avoids DB reads when conversation list reads are rate limited', async () => {
    rateLimitMock.checkConversationActionRateLimit.mockResolvedValueOnce({
      allowed: false,
      message: '消息读取过于频繁，请 18 秒后再试',
      retryAfterMs: 18_000
    })

    const { GET } = await import('~/app/api/message/conversation/route')
    const response = await GET(
      new Request(
        'https://www.otoame.top/api/message/conversation?page=1&limit=30'
      ) as never
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('retry-after')).toBe('18')
    await expect(response.json()).resolves.toBe(
      '消息读取过于频繁，请 18 秒后再试'
    )
    expect(rateLimitMock.checkConversationActionRateLimit).toHaveBeenCalledWith(
      'message-read',
      1007
    )
    expect(prismaMock.user_conversation.findMany).not.toHaveBeenCalled()
    expect(prismaMock.user_conversation.count).not.toHaveBeenCalled()
  })

  it('returns no-store cache headers when creating or opening a conversation', async () => {
    verifyHeaderCookieMock.mockResolvedValueOnce({ uid: 1007, role: 1 })
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ moemoepoint: 100 })
      .mockResolvedValueOnce({
        id: 8,
        allow_private_message: true
      })
    prismaMock.user_conversation.findUnique.mockResolvedValueOnce({
      id: 5,
      user_a_id: 1007,
      user_b_id: 8,
      user_a_hidden: true,
      user_b_hidden: false
    })
    prismaMock.user_conversation.update.mockResolvedValueOnce({
      id: 5,
      user_a_id: 1007,
      user_b_id: 8
    })

    const { POST } = await import('~/app/api/message/conversation/route')
    const response = await POST(
      new Request('https://www.otoame.top/api/message/conversation', {
        method: 'POST',
        body: JSON.stringify({ targetUserId: 8 }),
        headers: { 'Content-Type': 'application/json' }
      }) as never
    )

    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual({
      conversationId: 5,
      isNew: false
    })
  })

  it('returns personalized conversation check results with no-store cache headers', async () => {
    verifyHeaderCookieMock.mockResolvedValueOnce({ uid: 1007, role: 1 })
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ moemoepoint: 100 })
      .mockResolvedValueOnce({
        id: 8,
        name: 'Mio',
        allow_private_message: true
      })
    prismaMock.user_conversation.findUnique.mockResolvedValueOnce(null)

    const { GET } = await import('~/app/api/message/conversation/check/route')
    const response = await GET(
      new Request(
        'https://www.otoame.top/api/message/conversation/check?targetUserId=8'
      ) as never
    )

    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toMatchObject({
      exists: false,
      needsPayment: true,
      cost: 10,
      currentPoints: 100,
      targetUserName: 'Mio'
    })
  })

  it('returns 429 and avoids DB reads when conversation check is rate limited', async () => {
    verifyHeaderCookieMock.mockResolvedValueOnce({ uid: 1007, role: 1 })
    rateLimitMock.checkConversationActionRateLimit.mockResolvedValueOnce({
      allowed: false,
      message: '私聊操作过于频繁，请 45 秒后再试',
      retryAfterMs: 45_000
    })

    const { GET } = await import('~/app/api/message/conversation/check/route')
    const response = await GET(
      new Request(
        'https://www.otoame.top/api/message/conversation/check?targetUserId=8'
      ) as never
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('retry-after')).toBe('45')
    await expect(response.json()).resolves.toBe(
      '私聊操作过于频繁，请 45 秒后再试'
    )
    expect(rateLimitMock.checkConversationActionRateLimit).toHaveBeenCalledWith(
      'conversation-open',
      1007
    )
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.user_conversation.findUnique).not.toHaveBeenCalled()
  })

  it('returns 429 and avoids DB writes when opening a conversation is rate limited', async () => {
    verifyHeaderCookieMock.mockResolvedValueOnce({ uid: 1007, role: 1 })
    rateLimitMock.checkConversationActionRateLimit.mockResolvedValueOnce({
      allowed: false,
      message: '私聊操作过于频繁，请 30 秒后再试',
      retryAfterMs: 30_000
    })

    const { POST } = await import('~/app/api/message/conversation/route')
    const response = await POST(
      new Request('https://www.otoame.top/api/message/conversation', {
        method: 'POST',
        body: JSON.stringify({ targetUserId: 8 }),
        headers: { 'Content-Type': 'application/json' }
      }) as never
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('retry-after')).toBe('30')
    await expect(response.json()).resolves.toBe(
      '私聊操作过于频繁，请 30 秒后再试'
    )
    expect(rateLimitMock.checkConversationActionRateLimit).toHaveBeenCalledWith(
      'conversation-open',
      1007
    )
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.user_conversation.update).not.toHaveBeenCalled()
    expect(prismaMock.user_conversation.create).not.toHaveBeenCalled()
  })

  it('rejects beforeId and afterId together', async () => {
    const { getConversationMessagesSchema } = await import(
      '~/validations/conversation'
    )

    expect(
      getConversationMessagesSchema.safeParse({
        page: 1,
        limit: 30,
        beforeId: 10,
        afterId: 20
      }).success
    ).toBe(false)
  })

  it('accepts bounded reply image indexes in send payloads', async () => {
    const { sendPrivateMessageSchema } = await import(
      '~/validations/conversation'
    )

    expect(
      sendPrivateMessageSchema.safeParse({
        type: 0,
        content: 'reply',
        replyToMessageId: 3,
        replyImageIndex: 8
      }).success
    ).toBe(true)
    expect(
      sendPrivateMessageSchema.safeParse({
        type: 0,
        content: 'reply',
        replyToMessageId: 3,
        replyImageIndex: 9
      }).success
    ).toBe(false)
  })

  it('rejects image payloads that are declared as text messages', async () => {
    const { sendPrivateMessageSchema } = await import(
      '~/validations/conversation'
    )

    expect(
      sendPrivateMessageSchema.safeParse({
        type: 0,
        content: 'caption',
        image: {
          url: 'https://img.example/conversation/5/1007-chat.avif',
          width: 800,
          height: 600,
          size: 12345,
          mime: 'image/avif',
          name: 'chat.avif'
        }
      }).success
    ).toBe(false)
  })

  it('rejects whitespace-only edited private messages', async () => {
    const { updatePrivateMessageSchema } = await import(
      '~/validations/conversation'
    )

    expect(
      updatePrivateMessageSchema.safeParse({
        messageId: 3,
        content: '   '
      }).success
    ).toBe(false)
  })
})
