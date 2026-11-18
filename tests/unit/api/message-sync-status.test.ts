import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  verify: vi.fn(),
  unread: vi.fn(),
  conversations: vi.fn(),
  rateLimit: vi.fn()
}))
vi.mock('~/app/api/utils/sessionIdentity', () => ({
  getRequestIdentity: mocks.identity
}))
vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: mocks.verify
}))
vi.mock('~/app/api/message/service', () => ({
  getUnreadStatus: mocks.unread
}))
vi.mock('~/app/api/message/conversation/service', () => ({
  getConversations: mocks.conversations,
  getOrCreateConversation: vi.fn()
}))
vi.mock('~/app/api/message/conversation/rateLimit', () => ({
  checkConversationActionRateLimit: mocks.rateLimit
}))

const routes = [
  ['unread', '/api/message/unread'],
  ['conversation', '/api/message/conversation?page=1&limit=30']
] as const
const readRoute = async (route: (typeof routes)[number][0]) => {
  if (route === 'unread') return import('~/app/api/message/unread/route')
  return import('~/app/api/message/conversation/route')
}

describe.each(routes)('%s synchronization HTTP results', (route, path) => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.identity.mockResolvedValue({
      status: 'authenticated',
      payload: { uid: 7, role: 1 }
    })
    mocks.verify.mockResolvedValue({ uid: 7, role: 1 })
    mocks.rateLimit.mockResolvedValue({ allowed: true })
    mocks.unread.mockResolvedValue({
      hasUnreadMessages: true,
      hasUnreadChat: false
    })
    mocks.conversations.mockResolvedValue({ conversations: [], total: 0 })
  })

  it('returns 401 for a confirmed guest without clearing a possibly newer Cookie', async () => {
    mocks.identity.mockResolvedValue({ status: 'guest' })
    mocks.verify.mockResolvedValue(null)
    const { GET } = await readRoute(route)
    const response = await GET(
      new Request('https://www.otoame.top' + path) as never
    )
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code: 'SESSION_INVALID' })
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.rateLimit).not.toHaveBeenCalled()
    expect(mocks.unread).not.toHaveBeenCalled()
    expect(mocks.conversations).not.toHaveBeenCalled()
  })

  it('returns 503 for unavailable authentication without pretending the account is a guest', async () => {
    mocks.identity.mockResolvedValue({ status: 'unavailable' })
    const { GET } = await readRoute(route)
    const response = await GET(
      new Request('https://www.otoame.top' + path) as never
    )
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'SESSION_UNAVAILABLE' })
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(mocks.rateLimit).not.toHaveBeenCalled()
    expect(mocks.unread).not.toHaveBeenCalled()
    expect(mocks.conversations).not.toHaveBeenCalled()
  })

  it('returns a recoverable 503 if the message query fails', async () => {
    mocks.unread.mockRejectedValue(new Error('synthetic database outage'))
    mocks.conversations.mockRejectedValue(
      new Error('synthetic database outage')
    )
    const { GET } = await readRoute(route)
    const response = await GET(
      new Request('https://www.otoame.top' + path) as never
    )
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      code: 'MESSAGE_SYNC_UNAVAILABLE'
    })
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('retains the rate limit status and Retry-After deadline', async () => {
    mocks.rateLimit.mockResolvedValue({
      allowed: false,
      message: 'limited',
      retryAfterMs: 120_500
    })
    const { GET } = await readRoute(route)
    const response = await GET(
      new Request('https://www.otoame.top' + path) as never
    )
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('121')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(mocks.unread).not.toHaveBeenCalled()
    expect(mocks.conversations).not.toHaveBeenCalled()
  })
})
