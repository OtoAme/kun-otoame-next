import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyHeaderCookie: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn()
}))
vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: mocks.verifyHeaderCookie
}))
vi.mock('~/prisma/index', () => ({
  prisma: { admin_log: { findMany: mocks.findMany, count: mocks.count } }
}))

import { GET } from '~/app/api/admin/log/route'

const request = (query: string) =>
  new NextRequest(`https://example.test/api/admin/log?page=1&limit=30${query}`)

beforeEach(() => {
  vi.resetAllMocks()
  mocks.findMany.mockResolvedValue([])
  mocks.count.mockResolvedValue(0)
})

describe('GET /api/admin/log', () => {
  it.each([3, 4])('lets role %s read the log', async (role) => {
    mocks.verifyHeaderCookie.mockResolvedValue({ uid: 7, role })
    expect(await (await GET(request(''))).json()).toEqual({
      logs: [],
      total: 0
    })
  })

  it('rejects ordinary users without reading', async () => {
    mocks.verifyHeaderCookie.mockResolvedValue({ uid: 7, role: 2 })
    expect(await (await GET(request(''))).json()).toBe('本页面仅管理员可访问')
    expect(mocks.findMany).not.toHaveBeenCalled()
  })

  it('filters by type, operator and content with a stable order', async () => {
    mocks.verifyHeaderCookie.mockResolvedValue({ uid: 7, role: 3 })
    await GET(request('&type=creator_review&userId=2&search=%20kuro%20'))
    const where = {
      type: 'creator_review',
      user_id: 2,
      content: { contains: 'kuro', mode: 'insensitive' }
    }
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where,
        orderBy: [{ created: 'desc' }, { id: 'desc' }]
      })
    )
    expect(mocks.count).toHaveBeenCalledWith({ where })
  })

  it('rejects a malformed type instead of ignoring it', async () => {
    mocks.verifyHeaderCookie.mockResolvedValue({ uid: 7, role: 3 })
    const body = await (await GET(request('&type=DROP%20TABLE'))).json()
    expect(typeof body).toBe('string')
    expect(mocks.findMany).not.toHaveBeenCalled()
  })
})
