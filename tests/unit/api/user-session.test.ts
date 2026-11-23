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

vi.mock('~/app/api/utils/jwt', () => ({
  SessionUnavailableError: class extends Error {},
  verifyKunTokenResult: vi.fn()
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
    authMocks.verifyHeaderCookie.mockResolvedValue({
      uid: 1007,
      jti: 'test-session'
    })
    statusMocks.getStatus.mockResolvedValue(user)
    unreadMocks.getUnreadMessageStatus.mockResolvedValue({
      hasUnreadNotification: true,
      hasUnreadConversation: false
    })
    rateLimitMocks.checkConversationActionRateLimit.mockResolvedValue({
      allowed: true
    })
  })

  it('returns explicit invalid identity without mutating browser cookies', async () => {
    authMocks.verifyHeaderCookie.mockResolvedValueOnce(null)
    const { GET } = await import('~/app/api/user/session/route')
    const response = await GET(
      new Request('https://www.otoame.top/api/user/session', {
        headers: { cookie: 'kun-galgame-patch-moe-token=expired' }
      }) as never
    )
    expect(response.status).toBe(401)
    expect((await response.json()).code).toBe('SESSION_INVALID')
    expect(response.headers.has('Set-Cookie')).toBe(false)
  })

  it('confirms a clean anonymous request without cookie cleanup', async () => {
    authMocks.verifyHeaderCookie.mockResolvedValueOnce(null)
    const { GET } = await import('~/app/api/user/session/route')
    const response = await GET(
      new Request('https://www.otoame.top/api/user/session') as never
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'guest' })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.has('Set-Cookie')).toBe(false)
    expect(statusMocks.getStatus).not.toHaveBeenCalled()
  })

  it.each([
    'kun-galgame-patch-moe-token=',
    'kun-patch-setting-store|state|data|kunNsfwEnable=all',
    'kun-patch-setting-store|state|data|kunBlockedTagIds=%5B7%5D'
  ])('requires coordinated cleanup for residual cookies %s', async (cookie) => {
    authMocks.verifyHeaderCookie.mockResolvedValueOnce(null)
    const { GET } = await import('~/app/api/user/session/route')
    const response = await GET(
      new Request('https://www.otoame.top/api/user/session', {
        headers: { cookie }
      }) as never
    )
    expect(response.status).toBe(401)
    expect((await response.json()).code).toBe('SESSION_INVALID')
    expect(response.headers.has('Set-Cookie')).toBe(false)
  })

  it('does not delete a session that became authenticated before cleanup', async () => {
    const { DELETE } = await import('~/app/api/user/session/route')
    const response = await DELETE(
      new Request('https://www.otoame.top/api/user/session', {
        method: 'DELETE'
      }) as never
    )
    expect(response.status).toBe(409)
    expect(response.headers.has('Set-Cookie')).toBe(false)
  })

  it('only deletes cookies after cleanup independently confirms invalid identity', async () => {
    authMocks.verifyHeaderCookie.mockResolvedValueOnce(null)
    const { DELETE } = await import('~/app/api/user/session/route')
    const response = await DELETE(
      new Request('https://www.otoame.top/api/user/session', {
        method: 'DELETE'
      }) as never
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ cleared: true })
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0')
  })

  it('returns retryable infrastructure failure without deleting cookies', async () => {
    const { SessionUnavailableError } = await import('~/app/api/utils/jwt')
    authMocks.verifyHeaderCookie.mockRejectedValueOnce(
      new SessionUnavailableError()
    )
    const { GET } = await import('~/app/api/user/session/route')
    const response = await GET(
      new Request('https://www.otoame.top/api/user/session') as never
    )
    expect(response.status).toBe(503)
    expect((await response.json()).code).toBe('SESSION_UNAVAILABLE')
    expect(response.headers.has('Set-Cookie')).toBe(false)
  })

  it('returns the session with unread status on the normal path', async () => {
    const { GET } = await import('~/app/api/user/session/route')

    const response = await GET(
      new Request('https://www.otoame.top/api/user/session') as never
    )
    const body = await response.json()

    expect(
      rateLimitMocks.checkConversationActionRateLimit
    ).toHaveBeenCalledWith('notification-read', 1007)
    expect(unreadMocks.getUnreadMessageStatus).toHaveBeenCalledWith(1007)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(body).toEqual({
      user,
      context: expect.any(String),
      unread: {
        hasUnreadNotification: true,
        hasUnreadConversation: false
      }
    })
  })

  it('preserves missing unread on query failure', async () => {
    unreadMocks.getUnreadMessageStatus.mockRejectedValueOnce(
      new Error('offline')
    )
    const { GET } = await import('~/app/api/user/session/route')
    const response = await GET(
      new Request('https://www.otoame.top/api/user/session') as never
    )
    expect((await response.json()).unread).toBeNull()
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
      context: expect.any(String),
      unread: null
    })
  })
})
