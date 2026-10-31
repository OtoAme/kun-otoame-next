import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyHeaderCookie: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  queryRaw: vi.fn()
}))
vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: mocks.verifyHeaderCookie
}))
vi.mock('~/prisma/index', () => ({
  prisma: {
    admin_log: { findMany: mocks.findMany, count: mocks.count },
    $queryRaw: mocks.queryRaw
  }
}))

import { GET } from '~/app/api/admin/log/route'
import { EMAIL_MASK } from '~/utils/maskEmail'

const request = (query: string) =>
  new NextRequest(`https://example.test/api/admin/log?page=1&limit=30${query}`)

const userEditLog = {
  id: 9,
  type: 'update',
  user: { id: 2, name: '七海', avatar: '' },
  content:
    '管理员 七海 更改了一个用户的信息\n\n原用户信息:\n{"id":7,"email":"kuro@mail.example.com"}',
  created: new Date('2026-10-30T00:00:00Z')
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.findMany.mockResolvedValue([])
  mocks.count.mockResolvedValue(0)
  mocks.queryRaw.mockResolvedValue([])
})

describe('GET /api/admin/log', () => {
  it.each([3, 4])('lets role %s read the log', async (role) => {
    mocks.verifyHeaderCookie.mockResolvedValue({ uid: 7, role })
    const response = await GET(request(''))
    expect(await response.json()).toEqual({ logs: [], total: 0 })
    // The body depends on the role, so no shared cache may keep it.
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('rejects ordinary users without reading', async () => {
    mocks.verifyHeaderCookie.mockResolvedValue({ uid: 7, role: 2 })
    expect(await (await GET(request(''))).json()).toBe('本页面仅管理员可访问')
    expect(mocks.findMany).not.toHaveBeenCalled()
  })

  it('masks account emails for administrators but not super administrators', async () => {
    mocks.findMany.mockResolvedValue([userEditLog])
    mocks.count.mockResolvedValue(1)

    mocks.verifyHeaderCookie.mockResolvedValue({ uid: 7, role: 3 })
    const masked = await (await GET(request(''))).json()
    expect(masked.logs[0].content).toContain(`"email":"${EMAIL_MASK}"`)
    expect(JSON.stringify(masked)).not.toContain('kuro@mail.example.com')

    mocks.verifyHeaderCookie.mockResolvedValue({ uid: 7, role: 4 })
    const full = await (await GET(request(''))).json()
    expect(full.logs[0].content).toContain('kuro@mail.example.com')
  })

  it('filters by type, operator and content with a stable order for role 4', async () => {
    mocks.verifyHeaderCookie.mockResolvedValue({ uid: 7, role: 4 })
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
    expect(mocks.queryRaw).not.toHaveBeenCalled()
  })

  it('searches the masked text for administrators', async () => {
    mocks.verifyHeaderCookie.mockResolvedValue({ uid: 7, role: 3 })
    mocks.queryRaw.mockResolvedValue([{ id: 4 }, { id: 9 }])
    await GET(request('&type=update&userId=2&search=example'))

    const sql = mocks.queryRaw.mock.calls[0][0]
    expect(sql.sql).toContain('regexp_replace(content,')
    expect(sql.sql).toContain('ILIKE')
    // Parameters, never interpolated text.
    expect(sql.values).toContain('%example%')
    expect(sql.values).toContain('update')
    expect(sql.values).toContain(2)
    const where = { type: 'update', user_id: 2, id: { in: [4, 9] } }
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where })
    )
    expect(mocks.count).toHaveBeenCalledWith({ where })
  })

  it('escapes LIKE wildcards in a masked search', async () => {
    mocks.verifyHeaderCookie.mockResolvedValue({ uid: 7, role: 3 })
    await GET(request('&search=50%25_off'))
    expect(mocks.queryRaw.mock.calls[0][0].values).toContain('%50\\%\\_off%')
  })

  it('refuses an email search below role 4 before any query', async () => {
    mocks.verifyHeaderCookie.mockResolvedValue({ uid: 7, role: 3 })
    const body = await (
      await GET(request('&search=%40mail.example.com'))
    ).json()
    expect(body).toBe('只有超级管理员可以按邮箱搜索管理日志')
    expect(mocks.queryRaw).not.toHaveBeenCalled()
    expect(mocks.findMany).not.toHaveBeenCalled()
    expect(mocks.count).not.toHaveBeenCalled()
  })

  it('rejects a malformed type instead of ignoring it', async () => {
    mocks.verifyHeaderCookie.mockResolvedValue({ uid: 7, role: 3 })
    const body = await (await GET(request('&type=DROP%20TABLE'))).json()
    expect(typeof body).toBe('string')
    expect(mocks.findMany).not.toHaveBeenCalled()
  })
})
