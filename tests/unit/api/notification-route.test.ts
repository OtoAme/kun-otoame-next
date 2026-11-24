import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  context: vi.fn(),
  limit: vi.fn(),
  list: vi.fn(),
  read: vi.fn(),
  readAll: vi.fn(),
  clear: vi.fn(),
  create: vi.fn()
}))
vi.mock('~/app/api/utils/sessionIdentity', () => ({
  getSessionContext: mocks.context
}))
vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: mocks.identity
}))
vi.mock('~/app/api/message/conversation/rateLimit', () => ({
  checkConversationActionRateLimit: mocks.limit
}))
vi.mock('~/app/api/message/service', () => ({
  getMessage: mocks.list,
  readMessage: mocks.read,
  readAllMessages: mocks.readAll,
  clearReadMessage: mocks.clear,
  create: mocks.create
}))

import { GET } from '~/app/api/message/all/route'
import { DELETE, PUT } from '~/app/api/message/read/route'
import { POST } from '~/app/api/message/route'

const request = (method: string, body?: unknown) =>
  new NextRequest(
    `https://example.test/api/message/${method === 'GET' ? 'all?page=1&limit=30' : 'read'}`,
    {
      method,
      ...(body === undefined
        ? {}
        : {
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' }
          })
    }
  )

describe('notification route failure boundaries', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.identity.mockResolvedValue({ uid: 7 })
    mocks.context.mockReturnValue('b'.repeat(64))
    mocks.limit.mockResolvedValue({ allowed: true })
  })

  it.each([
    ['GET', GET],
    ['PUT', PUT],
    ['DELETE', DELETE]
  ] as const)(
    'keeps %s identity outages private and retryable',
    async (method, handler) => {
      mocks.identity.mockRejectedValueOnce(
        new Error('synthetic identity outage')
      )
      const response = await handler(
        request(
          method,
          method === 'PUT' ? { items: [{ id: 1, version: '1' }] } : undefined
        )
      )
      expect(response.status).toBe(503)
      expect(response.headers.get('Cache-Control')).toContain('no-store')
      expect(response.headers.has('Set-Cookie')).toBe(false)
      expect(mocks.list).not.toHaveBeenCalled()
      expect(mocks.read).not.toHaveBeenCalled()
      expect(mocks.clear).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['GET', GET],
    ['PUT', PUT],
    ['DELETE', DELETE]
  ] as const)(
    'rejects %s from an old displayed session before reading or mutating the cookie account',
    async (method, handler) => {
      mocks.list.mockResolvedValue({ messages: [] })
      mocks.read.mockResolvedValue({ results: [] })
      mocks.clear.mockResolvedValue({ deleted: 1 })
      const input = request(
        method,
        method === 'PUT' ? { items: [{ id: 1, version: '1' }] } : undefined
      )
      input.headers.set('X-Kun-Notification-Session', 'a'.repeat(64))
      const response = await handler(input)
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({
        code: 'NOTIFICATION_CONTEXT_CHANGED'
      })
      expect(mocks.list).not.toHaveBeenCalled()
      expect(mocks.read).not.toHaveBeenCalled()
      expect(mocks.clear).not.toHaveBeenCalled()
      expect(mocks.limit).not.toHaveBeenCalled()
    }
  )

  it('accepts a matching displayed session without changing the authenticated recipient', async () => {
    mocks.list.mockResolvedValue({ messages: [] })
    const input = request('GET')
    input.headers.set('X-Kun-Notification-Session', 'b'.repeat(64))
    expect((await GET(input)).status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith(expect.any(Object), 7)
  })

  it('rejects legacy unscoped writes without consuming the mutation limit', async () => {
    const response = await PUT(request('PUT'))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: 'NOTIFICATION_SCOPE_REQUIRED'
    })
    expect(mocks.limit).not.toHaveBeenCalled()
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('limits concrete confirmations to thirty distinct seen versions', async () => {
    const response = await PUT(
      request('PUT', {
        items: Array.from({ length: 31 }, (_, index) => ({
          id: index + 1,
          version: '1'
        }))
      })
    )
    expect(response.status).toBe(409)
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it.each(['all', 'help'] as const)(
    'accepts an explicit %s bulk scope with a matching session',
    async (scope) => {
      mocks.readAll.mockResolvedValue({ read: 75, summary: {} })
      const input = request('PUT', { scope })
      input.headers.set('X-Kun-Notification-Session', 'b'.repeat(64))
      const response = await PUT(input)
      expect(response.status).toBe(200)
      expect(mocks.readAll).toHaveBeenCalledExactlyOnceWith(7, { scope })
      expect(mocks.read).not.toHaveBeenCalled()
    }
  )

  it.each([
    { body: { scope: 'all' }, context: undefined },
    { body: { scope: 'all' }, context: 'a'.repeat(64) },
    { body: { scope: 'unknown' }, context: 'b'.repeat(64) },
    { body: { scope: 'all', recipientId: 8 }, context: 'b'.repeat(64) }
  ])(
    'rejects an invalid scope or session before bulk writes',
    async ({ body, context }) => {
      const input = request('PUT', body)
      if (context) input.headers.set('X-Kun-Notification-Session', context)
      expect((await PUT(input)).status).toBe(409)
      expect(mocks.readAll).not.toHaveBeenCalled()
      expect(mocks.limit).not.toHaveBeenCalled()
    }
  )

  it('returns a non-success status for invalid list filters', async () => {
    const response = await GET(
      new NextRequest('https://example.test/api/message/all?page=1.5&limit=30')
    )
    expect(response.status).toBe(400)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it.each([
    ['guest', null, 401],
    ['member', { uid: 7, role: 2 }, 403]
  ] as const)(
    'rejects %s manual notifications with an explicit status',
    async (_label, identity, status) => {
      mocks.identity.mockResolvedValueOnce(identity)
      const response = await POST(
        request('POST', {
          type: 'system',
          content: 'https://example.test/notice',
          recipientId: 8,
          link: '/help/1'
        })
      )
      expect(response.status).toBe(status)
      expect(response.headers.get('Cache-Control')).toContain('no-store')
      expect(mocks.create).not.toHaveBeenCalled()
    }
  )

  it.each(['identity', 'create'] as const)(
    'keeps manual notification %s outages retryable and private',
    async (source) => {
      mocks.identity.mockResolvedValue({ uid: 7, role: 3 })
      mocks[source].mockRejectedValueOnce(
        new Error('synthetic manual notification outage')
      )
      const response = await POST(
        request('POST', {
          type: 'system',
          content: 'https://example.test/notice',
          recipientId: 8,
          link: '/help/1'
        })
      )
      expect(response.status).toBe(503)
      expect(response.headers.get('Cache-Control')).toContain('no-store')
      expect(response.headers.has('Set-Cookie')).toBe(false)
    }
  )

  it('rejects fractional manual recipients before creating a notice', async () => {
    mocks.identity.mockResolvedValue({ uid: 7, role: 3 })
    const response = await POST(
      request('POST', {
        type: 'system',
        content: 'https://example.test/notice',
        recipientId: 8.5,
        link: '/help/1'
      })
    )
    expect(response.status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
