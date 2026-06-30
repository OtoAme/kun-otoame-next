import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user_conversation: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn()
  },
  user_private_message: {
    findMany: vi.fn(),
    count: vi.fn()
  }
}))

vi.mock('~/prisma/index', () => ({
  prisma: prismaMock
}))

const verifyHeaderCookieMock = vi.hoisted(() => vi.fn())
vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: verifyHeaderCookieMock
}))

describe('conversation message fetching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyHeaderCookieMock.mockResolvedValue({ uid: 1007 })
    prismaMock.user_conversation.findUnique.mockResolvedValue({
      id: 5,
      user_a_id: 1007,
      user_b_id: 8,
      user_a: { id: 1007, name: 'Saya', avatar: '/saya.webp' },
      user_b: { id: 8, name: 'Mio', avatar: '/mio.webp' }
    })
    prismaMock.user_private_message.count.mockResolvedValue(3)
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
        created: new Date('2026-06-30T10:00:00.000Z'),
        sender: { id: 1007, name: 'Saya', avatar: '/saya.webp' }
      }
    ])

    const { getConversationMessages } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    const result = await getConversationMessages(5, { page: 1, limit: 30 }, 1007)

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
            selectedText: 'quoted'
          }
        }
      ]
    })
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
})
