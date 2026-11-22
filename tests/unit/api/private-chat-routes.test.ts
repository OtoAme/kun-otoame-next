import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  list: vi.fn(),
  read: vi.fn(),
  limit: vi.fn()
}))
vi.mock('~/app/api/utils/sessionIdentity', () => ({
  getRequestIdentity: mocks.identity
}))
vi.mock('~/app/api/message/conversation/[id]/service', () => ({
  getConversationMessages: mocks.list,
  markConversationAsRead: mocks.read,
  sendMessage: vi.fn(),
  updateMessage: vi.fn(),
  deleteMessage: vi.fn(),
  deleteConversation: vi.fn()
}))
vi.mock('~/app/api/message/conversation/rateLimit', () => ({
  checkConversationActionRateLimit: mocks.limit
}))
vi.mock('~/app/api/message/unread/service', () => ({
  getUnreadMessageStatus: async () => ({
    hasUnreadNotification: false,
    hasUnreadConversation: false
  })
}))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.identity.mockResolvedValue({
    status: 'authenticated',
    payload: { uid: 1 }
  })
  mocks.limit.mockResolvedValue({ allowed: true })
  mocks.list.mockResolvedValue({ messages: [] })
  mocks.read.mockResolvedValue({ readThroughId: 77 })
})
const routes = async () => [
  {
    path: '/api/message/conversation/5?page=1&limit=50&afterId=0',
    method: 'GET',
    handler: (await import('~/app/api/message/conversation/[id]/route')).GET
  },
  {
    path: '/api/message/conversation/5/read',
    method: 'PUT',
    handler: (await import('~/app/api/message/conversation/[id]/read/route'))
      .PUT
  }
]

describe('private chat HTTP status and side-effect boundaries', () => {
  it.each(['guest', 'unavailable', 'throw'])(
    'uses explicit failure status for %s without deleting cookies or reading data',
    async (identity) => {
      if (identity === 'throw')
        mocks.identity.mockRejectedValue(
          new Error('Synthetic identity unavailable')
        )
      else mocks.identity.mockResolvedValue({ status: identity })
      for (const route of await routes()) {
        const response = await route.handler(
          new NextRequest(`http://localhost${route.path}`, {
            method: route.method
          }),
          { params: Promise.resolve({ id: '5' }) }
        )
        expect(response.status).toBe(identity === 'guest' ? 401 : 503)
        expect(response.headers.has('Set-Cookie')).toBe(false)
        expect(response.headers.get('Cache-Control')).toContain('no-store')
      }
      expect(mocks.list).not.toHaveBeenCalled()
      expect(mocks.read).not.toHaveBeenCalled()
    }
  )

  it('keeps bodyless range confirmation compatible and returns its independent watermark', async () => {
    const route = (await routes())[1]
    const response = await route.handler(
      new NextRequest(`http://localhost${route.path}`, { method: 'PUT' }),
      { params: Promise.resolve({ id: '5' }) }
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      readThroughId: 77,
      hasUnreadConversation: false
    })
    expect(mocks.read).toHaveBeenCalledWith(5, 1)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('keeps forbidden membership and foreign review targets as explicit failures', async () => {
    mocks.list.mockResolvedValue({
      kind: 'conversation-error',
      status: 403,
      code: 'CONVERSATION_UNAVAILABLE',
      message: 'safe'
    })
    const route = (await routes())[0]
    const response = await route.handler(
      new NextRequest(`http://localhost${route.path}`),
      { params: Promise.resolve({ id: '5' }) }
    )
    expect(response.status).toBe(403)
    expect(mocks.read).not.toHaveBeenCalled()
    mocks.list.mockResolvedValue({
      kind: 'conversation-error',
      status: 400,
      code: 'INVALID_REVIEW_IDS',
      message: 'safe'
    })
    const invalid = await route.handler(
      new NextRequest(`http://localhost${route.path}&reviewIds=9`),
      { params: Promise.resolve({ id: '5' }) }
    )
    expect(invalid.status).toBe(400)
  })
})
