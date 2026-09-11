import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyHeaderCookie: vi.fn(),
  getOverviewData: vi.fn(),
  getSumData: vi.fn()
}))

vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: mocks.verifyHeaderCookie
}))
vi.mock('~/app/api/admin/stats/service', () => ({
  getOverviewData: mocks.getOverviewData
}))
vi.mock('~/app/api/admin/stats/sum/service', () => ({
  getSumData: mocks.getSumData
}))

import { GET as getOverview } from '~/app/api/admin/stats/route'
import { GET as getSum } from '~/app/api/admin/stats/sum/route'

const noStore = (response: Response) =>
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')

beforeEach(() => {
  vi.resetAllMocks()
  mocks.verifyHeaderCookie.mockResolvedValue({ uid: 7, role: 4 })
  mocks.getOverviewData.mockResolvedValue({ newUser: 1 })
  mocks.getSumData.mockResolvedValue({ userCount: 1 })
})

describe('GET /api/admin/stats', () => {
  it.each([1, 60])('accepts the integer days boundary %s', async (days) => {
    const response = await getOverview(
      new NextRequest(`https://example.test/api/admin/stats?days=${days}`)
    )

    expect(response.status).toBe(200)
    noStore(response)
    expect(mocks.getOverviewData).toHaveBeenCalledWith(days)
  })

  it.each(['1.5', '0', '61', ''])(
    'rejects invalid days %s before reading stats',
    async (days) => {
      const query = days === '' ? '' : `?days=${days}`
      const response = await getOverview(
        new NextRequest(`https://example.test/api/admin/stats${query}`)
      )

      expect(response.status).toBe(200)
      noStore(response)
      expect(typeof (await response.json())).toBe('string')
      expect(mocks.verifyHeaderCookie).not.toHaveBeenCalled()
      expect(mocks.getOverviewData).not.toHaveBeenCalled()
    }
  )

  it('keeps the super-admin-only boundary and no-store response', async () => {
    mocks.verifyHeaderCookie.mockResolvedValue({ uid: 7, role: 3 })

    const response = await getOverview(
      new NextRequest('https://example.test/api/admin/stats?days=30')
    )

    expect(await response.json()).toBe('本页面仅超级管理员可访问')
    noStore(response)
    expect(mocks.getOverviewData).not.toHaveBeenCalled()
  })

  it('keeps the unauthenticated error private', async () => {
    mocks.verifyHeaderCookie.mockResolvedValue(null)

    const response = await getOverview(
      new NextRequest('https://example.test/api/admin/stats?days=30')
    )

    expect(await response.json()).toBe('用户未登录')
    noStore(response)
    expect(mocks.getOverviewData).not.toHaveBeenCalled()
  })
})

describe('GET /api/admin/stats/sum', () => {
  it('returns the cumulative response for role 4 with no-store headers', async () => {
    const response = await getSum(
      new NextRequest('https://example.test/api/admin/stats/sum')
    )

    expect(response.status).toBe(200)
    noStore(response)
    expect(await response.json()).toEqual({ userCount: 1 })
    expect(mocks.getSumData).toHaveBeenCalledOnce()
  })

  it.each([
    [null, '用户未登录'],
    [{ uid: 7, role: 3 }, '本页面仅超级管理员可访问']
  ] as const)(
    'rejects %j without reading cumulative stats',
    async (payload, message) => {
      mocks.verifyHeaderCookie.mockResolvedValue(payload)

      const response = await getSum(
        new NextRequest('https://example.test/api/admin/stats/sum')
      )

      expect(await response.json()).toBe(message)
      noStore(response)
      expect(mocks.getSumData).not.toHaveBeenCalled()
    }
  )
})
