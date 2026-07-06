import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const prismaMocks = vi.hoisted(() => ({
  patch_resource: {
    findMany: vi.fn()
  },
  patch_resource_link: {
    findFirst: vi.fn()
  },
  patch_resource_access: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn()
  }
}))

const authMocks = vi.hoisted(() => ({
  verifyHeaderCookie: vi.fn()
}))

vi.mock('~/prisma/index', () => ({
  prisma: prismaMocks
}))

vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: authMocks.verifyHeaderCookie
}))

vi.mock('~/lib/redis', () => ({
  acquireKvLock: vi.fn(),
  releaseKvLock: vi.fn()
}))

vi.mock('~/app/api/utils/getPatchVisibilityWhere', () => ({
  getPatchVisibilityWhere: vi.fn().mockResolvedValue({ content_limit: 'sfw' })
}))

const jsonRequest = (body: unknown, cookie = '') =>
  new NextRequest('https://www.otoame.top/api/patch/resource/download/access', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: JSON.stringify(body)
  })

describe('resource download access Phase 2 API', () => {
  beforeEach(() => {
    prismaMocks.patch_resource.findMany.mockReset()
    prismaMocks.patch_resource_link.findFirst.mockReset()
    prismaMocks.patch_resource_access.findMany.mockReset()
    prismaMocks.patch_resource_access.findFirst.mockReset()
    prismaMocks.patch_resource_access.create.mockReset()
    authMocks.verifyHeaderCookie.mockReset()
    authMocks.verifyHeaderCookie.mockResolvedValue(null)
  })

  it('omits content, code, and password from resource list links while keeping hash', async () => {
    const { getPatchResource } = await import('~/app/api/patch/resource/get')

    prismaMocks.patch_resource.findMany.mockResolvedValueOnce([
      {
        id: 11,
        name: 'Main resource',
        section: 'galgame',
        type: ['game'],
        language: ['zh'],
        note: '',
        platform: ['windows'],
        download: 0,
        status: 0,
        user_id: 3,
        patch_id: 7,
        created: new Date('2026-07-06T00:00:00.000Z'),
        patch: { unique_id: 'ABCDEFGH' },
        user: {
          id: 3,
          name: 'Saya',
          avatar: '',
          role: 2,
          _count: { patch_resource: 1 }
        },
        links: [
          {
            id: 21,
            storage: 's3',
            size: '1 GB',
            code: 'secret-code',
            password: 'secret-password',
            hash: 'hash-value',
            content: 'https://example.com/file',
            sort_order: 1,
            download: 5
          }
        ],
        _count: { like_by: 0 },
        like_by: []
      }
    ])

    prismaMocks.patch_resource_access.findMany.mockResolvedValueOnce([])

    const resources = await getPatchResource({ patchId: 7 }, { uid: 0 })

    expect(resources[0].links[0]).toEqual({
      id: 21,
      storage: 's3',
      size: '1 GB',
      hash: 'hash-value',
      sortOrder: 1,
      download: 5
    })
  })

  it('marks active user access records on resource list links without exposing sensitive fields', async () => {
    const { getPatchResource } = await import('~/app/api/patch/resource/get')
    const expires = new Date('2026-07-09T00:00:00.000Z')

    prismaMocks.patch_resource.findMany.mockResolvedValueOnce([
      {
        id: 11,
        name: 'Main resource',
        section: 'galgame',
        type: ['game'],
        language: ['zh'],
        note: '',
        platform: ['windows'],
        download: 0,
        status: 0,
        user_id: 3,
        patch_id: 7,
        created: new Date('2026-07-06T00:00:00.000Z'),
        patch: { unique_id: 'ABCDEFGH' },
        user: {
          id: 3,
          name: 'Saya',
          avatar: '',
          role: 2,
          _count: { patch_resource: 1 }
        },
        links: [
          {
            id: 21,
            storage: 'user',
            size: '2 GB',
            hash: '',
            sort_order: 1,
            download: 5
          }
        ],
        _count: { like_by: 0 },
        like_by: []
      }
    ])
    prismaMocks.patch_resource_access.findMany.mockResolvedValueOnce([
      { link_id: 21, expires }
    ])

    const resources = await getPatchResource({ patchId: 7 }, { uid: 1007 })

    expect(prismaMocks.patch_resource_access.findMany).toHaveBeenCalledWith({
      where: {
        user_id: 1007,
        link_id: { in: [21] },
        expires: { gt: expect.any(Date) }
      },
      select: {
        link_id: true,
        expires: true
      },
      orderBy: { expires: 'desc' }
    })
    expect(resources[0].links[0]).toMatchObject({
      id: 21,
      obtained: true,
      obtainedExpiresAt: expires.toISOString()
    })
    expect(resources[0].links[0]).not.toHaveProperty('content')
    expect(resources[0].links[0]).not.toHaveProperty('code')
    expect(resources[0].links[0]).not.toHaveProperty('password')
  })

  it('marks active visitor access records on resource list route and keeps the response private', async () => {
    const { GET } = await import('~/app/api/patch/resource/route')
    const visitorToken = '123e4567-e89b-42d3-a456-426614174000'
    const expires = new Date('2026-07-09T00:00:00.000Z')

    prismaMocks.patch_resource.findMany.mockResolvedValueOnce([
      {
        id: 11,
        name: 'Main resource',
        section: 'galgame',
        type: ['game'],
        language: ['zh'],
        note: '',
        platform: ['windows'],
        download: 0,
        status: 0,
        user_id: 3,
        patch_id: 7,
        created: new Date('2026-07-06T00:00:00.000Z'),
        patch: { unique_id: 'ABCDEFGH' },
        user: {
          id: 3,
          name: 'Saya',
          avatar: '',
          role: 2,
          _count: { patch_resource: 1 }
        },
        links: [
          {
            id: 21,
            storage: 'user',
            size: '2 GB',
            hash: '',
            sort_order: 1,
            download: 5
          }
        ],
        _count: { like_by: 0 },
        like_by: []
      }
    ])
    prismaMocks.patch_resource_access.findMany.mockResolvedValueOnce([
      { link_id: 21, expires }
    ])

    const response = await GET(
      new NextRequest('https://www.otoame.top/api/patch/resource?patchId=7', {
        headers: {
          Cookie: `kun-resource-access-token=${visitorToken}`
        }
      })
    )

    await expect(response.json()).resolves.toMatchObject([
      {
        links: [
          {
            id: 21,
            obtained: true,
            obtainedExpiresAt: expires.toISOString()
          }
        ]
      }
    ])
    expect(prismaMocks.patch_resource_access.findMany).toHaveBeenCalledWith({
      where: {
        visitor_token: visitorToken,
        link_id: { in: [21] },
        expires: { gt: expect.any(Date) }
      },
      select: {
        link_id: true,
        expires: true
      },
      orderBy: { expires: 'desc' }
    })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('creates a zero-cost visitor access record and sets the visitor cookie', async () => {
    const { POST } = await import(
      '~/app/api/patch/resource/download/access/route'
    )
    const expires = new Date('2026-07-09T00:00:00.000Z')

    prismaMocks.patch_resource_link.findFirst.mockResolvedValueOnce({
      id: 21,
      storage: 'user',
      size: '2 GB',
      content: 'https://pan.example.com/share',
      code: 'abcd',
      password: 'pass',
      hash: '',
      resource: {
        id: 11,
        section: 'galgame',
        patch_id: 7
      }
    })
    prismaMocks.patch_resource_access.findFirst.mockResolvedValueOnce(null)
    prismaMocks.patch_resource_access.create.mockResolvedValueOnce({
      expires
    })

    const response = await POST(
      jsonRequest({ patchId: 7, resourceId: 11, linkId: 21 })
    )

    await expect(response.json()).resolves.toEqual({
      link: {
        id: 21,
        storage: 'user',
        size: '2 GB',
        content: 'https://pan.example.com/share',
        code: 'abcd',
        password: 'pass',
        hash: ''
      },
      access: {
        actorType: 'visitor',
        cost: 0,
        reused: false,
        obtainedExpiresAt: expires.toISOString()
      }
    })
    expect(prismaMocks.patch_resource_link.findFirst).toHaveBeenCalledWith({
      where: {
        id: 21,
        resource_id: 11,
        resource: {
          id: 11,
          patch_id: 7,
          status: 0,
          patch: {
            id: 7,
            status: 0,
            content_limit: 'sfw'
          }
        }
      },
      select: {
        id: true,
        storage: true,
        size: true,
        content: true,
        code: true,
        password: true,
        hash: true,
        resource: {
          select: {
            id: true,
            section: true,
            patch_id: true
          }
        },
      }
    })
    expect(prismaMocks.patch_resource_access.create).toHaveBeenCalledWith({
      data: {
        actor_type: 'visitor',
        user_id: null,
        visitor_token: expect.any(String),
        patch_id: 7,
        resource_id: 11,
        link_id: 21,
        section: 'galgame',
        storage: 'user',
        cost: 0,
        expires: expect.any(Date)
      }
    })
    expect(response.headers.get('set-cookie')).toContain(
      'kun-resource-access-token='
    )
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('reuses an active logged-in access record without creating another record', async () => {
    const { POST } = await import(
      '~/app/api/patch/resource/download/access/route'
    )
    const expires = new Date('2026-07-09T00:00:00.000Z')

    authMocks.verifyHeaderCookie.mockResolvedValueOnce({
      uid: 1007,
      name: 'Saya',
      role: 1
    })
    prismaMocks.patch_resource_link.findFirst.mockResolvedValueOnce({
      id: 21,
      storage: 'user',
      size: '2 GB',
      content: 'https://pan.example.com/share',
      code: 'abcd',
      password: 'pass',
      hash: '',
      resource: {
        id: 11,
        section: 'galgame',
        patch_id: 7
      }
    })
    prismaMocks.patch_resource_access.findFirst.mockResolvedValueOnce({
      expires
    })

    const response = await POST(
      jsonRequest({ patchId: 7, resourceId: 11, linkId: 21 })
    )

    await expect(response.json()).resolves.toMatchObject({
      access: {
        actorType: 'user',
        cost: 0,
        reused: true,
        obtainedExpiresAt: expires.toISOString()
      }
    })
    expect(prismaMocks.patch_resource_access.findFirst).toHaveBeenCalledWith({
      where: {
        user_id: 1007,
        link_id: 21,
        expires: { gt: expect.any(Date) }
      },
      select: {
        expires: true
      },
      orderBy: { expires: 'desc' }
    })
    expect(prismaMocks.patch_resource_access.create).not.toHaveBeenCalled()
  })
})
