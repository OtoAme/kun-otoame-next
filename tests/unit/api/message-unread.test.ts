import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user_message: {
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

describe('message unread status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyHeaderCookieMock.mockResolvedValue({ uid: 1007 })
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
          { user_a_id: 1007, user_a_unread_count: { gt: 0 } },
          { user_b_id: 1007, user_b_unread_count: { gt: 0 } }
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
  })

  it('marks notification messages as read without changing conversation counters', async () => {
    const { readMessage } = await import('~/app/api/message/service')

    await readMessage(1007)

    expect(prismaMock.user_message.updateMany).toHaveBeenCalledWith({
      where: { recipient_id: 1007 },
      data: { status: { set: 1 } }
    })
    expect(prismaMock.user_conversation.findFirst).not.toHaveBeenCalled()
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
  })
})
