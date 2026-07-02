import { beforeEach, describe, expect, it, vi } from 'vitest'

const authMocks = vi.hoisted(() => ({
  verifyHeaderCookie: vi.fn()
}))

const statusMocks = vi.hoisted(() => ({
  getStatus: vi.fn()
}))

const unreadMocks = vi.hoisted(() => ({
  getUnreadMessageStatus: vi.fn()
}))

const rateLimitMocks = vi.hoisted(() => ({
  checkConversationActionRateLimit: vi.fn()
}))

vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: authMocks.verifyHeaderCookie
}))

vi.mock('~/app/api/user/status/service', () => ({
  getStatus: statusMocks.getStatus
}))

vi.mock('~/app/api/message/unread/service', () => ({
  getUnreadMessageStatus: unreadMocks.getUnreadMessageStatus
}))

vi.mock('~/app/api/message/conversation/rateLimit', () => ({
  checkConversationActionRateLimit:
    rateLimitMocks.checkConversationActionRateLimit
}))

const user = {
  uid: 1007,
  name: 'Saya',
  avatar: '',
  bio: '',
  moemoepoint: 100,
  role: 3,
  dailyCheckIn: 0,
  dailyImageLimit: 0,
  dailyUploadLimit: 0,
  enableEmailNotice: true,
  allowPrivateMessage: true,
  blockedTagIds: [],
  enableRedirect: true,
  excludedDomains: [],
  delaySeconds: 5
}

describe('/api/user/session', () => {
  beforeEach(() => {
    vi.resetModules()
    authMocks.verifyHeaderCookie.mockReset()
    statusMocks.getStatus.mockReset()
    unreadMocks.getUnreadMessageStatus.mockReset()
    rateLimitMocks.checkConversationActionRateLimit.mockReset()
    authMocks.verifyHeaderCookie.mockResolvedValue({ uid: 1007 })
    statusMocks.getStatus.mockResolvedValue(user)
    unreadMocks.getUnreadMessageStatus.mockResolvedValue({
      hasUnreadNotification: true,
      hasUnreadConversation: false
    })
    rateLimitMocks.checkConversationActionRateLimit.mockResolvedValue({
      allowed: true
    })
  })

  it('returns the session with unread status on the normal path', async () => {
    const { GET } = await import('~/app/api/user/session/route')

    const response = await GET(
      new Request('https://www.otoame.top/api/user/session') as never
    )
    const body = await response.json()

    expect(rateLimitMocks.checkConversationActionRateLimit).toHaveBeenCalledWith(
      'notification-read',
      1007
    )
    expect(unreadMocks.getUnreadMessageStatus).toHaveBeenCalledWith(1007)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(body).toEqual({
      user,
      unread: {
        hasUnreadNotification: true,
        hasUnreadConversation: false
      }
    })
  })

  it('does not read unread message state when session unread refresh is rate limited', async () => {
    rateLimitMocks.checkConversationActionRateLimit.mockResolvedValueOnce({
      allowed: false,
      retryAfterMs: 30_000,
      message: '通知读取过于频繁，请 30 秒后再试'
    })

    const { GET } = await import('~/app/api/user/session/route')

    const response = await GET(
      new Request('https://www.otoame.top/api/user/session') as never
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(statusMocks.getStatus).toHaveBeenCalledWith(1007)
    expect(unreadMocks.getUnreadMessageStatus).not.toHaveBeenCalled()
    expect(body).toEqual({
      user,
      unread: null
    })
  })
})
