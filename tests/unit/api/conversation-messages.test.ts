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

  it('returns only messages newer than afterId in chronological order', async () => {
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
    expect(result).toMatchObject({
      total: 3,
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
})
