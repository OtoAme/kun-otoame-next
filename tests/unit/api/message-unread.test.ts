import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user_message: {
    findFirst: vi.fn(),
    updateMany: vi.fn()
  },
  user_conversation: {
    findFirst: vi.fn()
  }
}))

vi.mock('~/prisma/index', () => ({
  prisma: prismaMock
}))

describe('message unread status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
