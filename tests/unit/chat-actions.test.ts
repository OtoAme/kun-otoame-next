import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyHeaderCookie: vi.fn(),
  getConversations: vi.fn(),
  getConversationMessages: vi.fn(),
  checkConversationActionRateLimit: vi.fn()
}))

vi.mock('~/utils/actions/verifyHeaderCookie', () => ({
  verifyHeaderCookie: mocks.verifyHeaderCookie
}))

vi.mock('~/app/api/message/conversation/service', () => ({
  getConversations: mocks.getConversations
}))

vi.mock('~/app/api/message/conversation/[id]/service', () => ({
  getConversationMessages: mocks.getConversationMessages
}))

vi.mock('~/app/api/message/conversation/rateLimit', () => ({
  checkConversationActionRateLimit: mocks.checkConversationActionRateLimit
}))

describe('chat server actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.verifyHeaderCookie.mockResolvedValue({ uid: 1007 })
    mocks.checkConversationActionRateLimit.mockResolvedValue({ allowed: true })
    mocks.getConversations.mockResolvedValue({
      conversations: [],
      total: 0
    })
    mocks.getConversationMessages.mockResolvedValue({
      messages: [],
      total: 0,
      hasMoreBefore: false,
      otherUser: { id: 8, name: 'Mio', avatar: '/mio.webp' }
    })
  })

  it('rejects malformed conversation IDs before auth or DB reads', async () => {
    const { kunGetConversationMessagesAction } = await import(
      '~/app/message/chat/actions'
    )

    const result = await kunGetConversationMessagesAction('5abc' as never, {
      page: 1,
      limit: 30
    })

    expect(result).toBe('无效的会话 ID')
    expect(mocks.verifyHeaderCookie).not.toHaveBeenCalled()
    expect(mocks.checkConversationActionRateLimit).not.toHaveBeenCalled()
    expect(mocks.getConversationMessages).not.toHaveBeenCalled()
  })

  it('applies the message-read rate limit before loading initial messages', async () => {
    mocks.checkConversationActionRateLimit.mockResolvedValueOnce({
      allowed: false,
      message: '消息读取过于频繁，请 12 秒后再试',
      retryAfterMs: 12_000
    })

    const { kunGetConversationMessagesAction } = await import(
      '~/app/message/chat/actions'
    )

    const result = await kunGetConversationMessagesAction(5, {
      page: 1,
      limit: 30
    })

    expect(result).toBe('消息读取过于频繁，请 12 秒后再试')
    expect(mocks.checkConversationActionRateLimit).toHaveBeenCalledWith(
      'message-read',
      1007
    )
    expect(mocks.getConversationMessages).not.toHaveBeenCalled()
  })

  it('applies the message-read rate limit before loading the initial conversation list', async () => {
    mocks.checkConversationActionRateLimit.mockResolvedValueOnce({
      allowed: false,
      message: '消息读取过于频繁，请 15 秒后再试',
      retryAfterMs: 15_000
    })

    const { kunGetConversationsAction } = await import(
      '~/app/message/chat/actions'
    )

    const result = await kunGetConversationsAction({ page: 1, limit: 30 })

    expect(result).toBe('消息读取过于频繁，请 15 秒后再试')
    expect(mocks.checkConversationActionRateLimit).toHaveBeenCalledWith(
      'message-read',
      1007
    )
    expect(mocks.getConversations).not.toHaveBeenCalled()
  })
})
