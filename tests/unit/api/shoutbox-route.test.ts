import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const routeMocks = vi.hoisted(() => {
  class MockMoemoepointInsufficientError extends Error {}
  return {
    verifyHeaderCookie: vi.fn(),
    createShoutbox: vi.fn(),
    createOfficialShoutbox: vi.fn(),
    deleteShoutbox: vi.fn(),
    getAdminShoutboxList: vi.fn(),
    getAdminOfficialShoutboxes: vi.fn(),
    getShoutboxList: vi.fn(),
    getShoutboxBanner: vi.fn(),
    getUserShoutboxes: vi.fn(),
    updateOfficialShoutbox: vi.fn(),
    updateShoutbox: vi.fn(),
    moderateShoutbox: vi.fn(),
    MoemoepointInsufficientError: MockMoemoepointInsufficientError
  }
})

vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: routeMocks.verifyHeaderCookie
}))
vi.mock('~/app/api/shoutbox/service', () => routeMocks)
vi.mock('~/app/api/admin/shoutbox/service', () => routeMocks)
vi.mock('~/app/api/shoutbox/cache', () => ({
  getShoutboxCacheControl: vi.fn((validUntil: string) =>
    new Date(validUntil).getTime() > Date.now()
      ? 'public, s-maxage=30'
      : 'no-store'
  )
}))
vi.mock('~/app/api/utils/getPatchVisibilityWhere', () => ({
  getPatchVisibilityWhere: vi.fn(async () => ({}))
}))
vi.mock('~/app/api/utils/cacheHeaders', () => ({
  isPersonalizedApiRequest: vi.fn(() => false)
}))

import { POST } from '~/app/api/shoutbox/route'
import { GET as listGET } from '~/app/api/shoutbox/route'
import { GET as bannerGET } from '~/app/api/shoutbox/banner/route'
import {
  GET as adminGET,
  POST as adminPOST,
  PUT as adminPUT
} from '~/app/api/admin/shoutbox/route'
import { POST as moderatePOST } from '~/app/api/admin/shoutbox/moderate/route'
import { GET as profileGET } from '~/app/api/user/profile/shoutbox/route'

beforeEach(() => {
  vi.clearAllMocks()
  routeMocks.verifyHeaderCookie.mockResolvedValue({ uid: 7, role: 3 })
  routeMocks.getAdminShoutboxList.mockResolvedValue({
    shoutboxes: [],
    page: 1,
    totalPages: 0
  })
  routeMocks.createOfficialShoutbox.mockResolvedValue({})
  routeMocks.updateOfficialShoutbox.mockResolvedValue({})
  routeMocks.moderateShoutbox.mockResolvedValue({})
})

const adminMutationCases = [
  {
    name: 'official publish',
    service: routeMocks.createOfficialShoutbox,
    request: () =>
      new NextRequest('https://example.test/api/admin/shoutbox', {
        method: 'POST',
        body: JSON.stringify({
          requestId: '550e8400-e29b-41d4-a716-446655440000',
          content: '维护通知'
        })
      }),
    run: (request: NextRequest) => adminPOST(request)
  },
  {
    name: 'official update',
    service: routeMocks.updateOfficialShoutbox,
    request: () =>
      new NextRequest('https://example.test/api/admin/shoutbox', {
        method: 'PUT',
        body: JSON.stringify({ shoutboxId: 12, action: 'cancel' })
      }),
    run: (request: NextRequest) => adminPUT(request)
  },
  {
    name: 'moderation',
    service: routeMocks.moderateShoutbox,
    request: () =>
      new NextRequest('https://example.test/api/admin/shoutbox/moderate', {
        method: 'POST',
        body: JSON.stringify({ shoutboxId: 12, action: 'remove' })
      }),
    run: (request: NextRequest) => moderatePOST(request)
  }
] as const

describe('POST /api/shoutbox', () => {
  it('turns an insufficient-point error into the API error string without cache invalidation', async () => {
    routeMocks.createShoutbox.mockRejectedValueOnce(
      new routeMocks.MoemoepointInsufficientError()
    )

    const response = await POST(
      new NextRequest('https://example.test/api/shoutbox', {
        method: 'POST',
        body: JSON.stringify({
          requestId: '550e8400-e29b-41d4-a716-446655440000',
          content: '内容'
        })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toBe('可用萌萌点不足')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
})

describe('GET /api/shoutbox', () => {
  it('does not publicly cache a safe empty result after refresh failure', async () => {
    routeMocks.getShoutboxList.mockResolvedValueOnce({
      pinned: null,
      shoutboxes: [],
      page: 1,
      totalPages: 0,
      validUntil: new Date(0).toISOString()
    })

    const response = await listGET(
      new NextRequest('https://example.test/api/shoutbox?page=1&limit=6')
    )

    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})

describe('GET /api/shoutbox/banner', () => {
  it('does not publicly cache a safe empty result after refresh failure', async () => {
    routeMocks.getShoutboxBanner.mockResolvedValueOnce({
      banner: null,
      validUntil: new Date(0).toISOString()
    })

    const response = await bannerGET(
      new NextRequest('https://example.test/api/shoutbox/banner')
    )

    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})

describe('GET /api/admin/shoutbox', () => {
  it('rejects role 2 before loading any admin list', async () => {
    routeMocks.verifyHeaderCookie.mockResolvedValueOnce({ uid: 7, role: 2 })

    const response = await adminGET(
      new NextRequest(
        'https://example.test/api/admin/shoutbox?tab=pending_review&page=1&limit=20'
      )
    )

    expect(await response.json()).toBe('本页面仅管理员可访问')
    expect(routeMocks.getAdminShoutboxList).not.toHaveBeenCalled()
    expect(routeMocks.getAdminOfficialShoutboxes).not.toHaveBeenCalled()
  })

  it('loads the official tab for role 3 with a private no-store response', async () => {
    routeMocks.getAdminOfficialShoutboxes.mockResolvedValueOnce({
      shoutboxes: [],
      page: 1,
      totalPages: 0
    })

    const response = await adminGET(
      new NextRequest(
        'https://example.test/api/admin/shoutbox?tab=official&page=1&limit=20'
      )
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({
      shoutboxes: [],
      page: 1,
      totalPages: 0
    })
    expect(routeMocks.getAdminOfficialShoutboxes).toHaveBeenCalledWith(
      {
        page: 1,
        limit: 20,
        tab: 'official'
      },
      { adminRole: 3 }
    )
  })

  it('rejects unresolved tabs at schema parsing', async () => {
    const response = await adminGET(
      new NextRequest(
        'https://example.test/api/admin/shoutbox?tab=pending_review&page=1&limit=20'
      )
    )

    expect(response.status).toBe(200)
    expect(await response.json()).not.toBe(
      '小喇叭待复核列表将在举报规则确定后开放'
    )
    expect(routeMocks.getAdminOfficialShoutboxes).not.toHaveBeenCalled()
    expect(routeMocks.getAdminShoutboxList).toHaveBeenCalledWith(
      { page: 1, limit: 20, tab: 'pending_review' },
      { adminRole: 3 }
    )
  })
})

describe('admin shoutbox mutation routes', () => {
  it.each(adminMutationCases)(
    '$name rejects an unauthenticated request',
    async ({ run, request, service }) => {
      routeMocks.verifyHeaderCookie.mockResolvedValueOnce(null)

      const response = await run(request())

      expect(await response.json()).toBe('用户未登录')
      expect(service).not.toHaveBeenCalled()
    }
  )

  it.each(adminMutationCases)(
    '$name rejects roles 1 and 2',
    async ({ run, request, service }) => {
      for (const role of [1, 2]) {
        routeMocks.verifyHeaderCookie.mockResolvedValueOnce({ uid: 7, role })

        const response = await run(request())

        expect(await response.json()).toBe('本页面仅管理员可访问')
      }
      expect(service).not.toHaveBeenCalled()
    }
  )

  it.each(adminMutationCases)(
    '$name allows role 3',
    async ({ run, request, service }) => {
      const response = await run(request())

      expect(response.status).toBe(200)
      expect(service).toHaveBeenCalledOnce()
    }
  )
})

describe('GET /api/user/profile/shoutbox', () => {
  it('requires login before reading an author archive', async () => {
    routeMocks.verifyHeaderCookie.mockResolvedValueOnce(null)

    const response = await profileGET(
      new NextRequest(
        'https://example.test/api/user/profile/shoutbox?uid=7&page=1&limit=6'
      )
    )

    expect(await response.json()).toBe('用户未登录')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(routeMocks.getUserShoutboxes).not.toHaveBeenCalled()
  })
})
