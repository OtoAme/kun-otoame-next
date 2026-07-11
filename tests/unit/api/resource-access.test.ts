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
  },
  patch_resource_access_grant: {
    findMany: vi.fn()
  }
}))

const authMocks = vi.hoisted(() => ({
  verifyHeaderCookie: vi.fn()
}))

const actorMocks = vi.hoisted(() => ({
  getResourceAccessActor: vi.fn()
}))

const grantMocks = vi.hoisted(() => ({
  resolveResourceAccessGrant: vi.fn()
}))

const rateLimitMocks = vi.hoisted(() => ({
  checkResourceAccessActionRateLimit: vi.fn()
}))

const visibilityMocks = vi.hoisted(() => ({
  getPatchVisibilityWhere: vi.fn()
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

vi.mock('~/app/api/patch/resource/download/access/rateLimit', () => ({
  checkResourceAccessActionRateLimit:
    rateLimitMocks.checkResourceAccessActionRateLimit
}))

vi.mock(
  '~/app/api/patch/resource/download/access/actor',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('~/app/api/patch/resource/download/access/actor')
      >()
    actorMocks.getResourceAccessActor.mockImplementation(
      actual.getResourceAccessActor
    )
    return {
      ...actual,
      getResourceAccessActor: actorMocks.getResourceAccessActor
    }
  }
)

vi.mock(
  '~/app/api/patch/resource/download/access/grant',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('~/app/api/patch/resource/download/access/grant')
      >()
    return {
      ...actual,
      resolveResourceAccessGrant: grantMocks.resolveResourceAccessGrant
    }
  }
)

vi.mock('~/app/api/utils/getPatchVisibilityWhere', () => ({
  getPatchVisibilityWhere: visibilityMocks.getPatchVisibilityWhere
}))

const VISITOR_TOKEN = '123e4567-e89b-42d3-a456-426614174000'
const EXPIRES = new Date('2026-07-12T00:00:00.000Z')
const QUOTA = {
  scope: 'visitor' as const,
  resourceKind: 'galgame' as const,
  remaining: { daily: 4, weekly: 19 },
  resetsAt: {
    daily: '2026-07-11T16:00:00.000Z',
    weekly: '2026-07-12T16:00:00.000Z'
  }
}

const previewLink = (id: number, sortOrder: number) => ({
  id,
  storage: 'user',
  size: `${sortOrder} GB`,
  code: `secret-code-${id}`,
  password: `secret-password-${id}`,
  hash: `hash-${id}`,
  content: `https://pan.example.com/share/${id}`,
  sort_order: sortOrder,
  download: sortOrder + 4
})

const resourceRow = (links = [previewLink(21, 1)]) => ({
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
  links,
  _count: { like_by: 0 },
  like_by: []
})

const accessLink = (section: string = 'galgame') => ({
  id: 21,
  storage: 'user',
  size: '2 GB',
  content: 'https://pan.example.com/share',
  code: 'abcd',
  password: 'pass',
  hash: '',
  resource: {
    id: 11,
    section,
    patch_id: 7
  }
})

const jsonRequest = (body: unknown, cookie = '') =>
  new NextRequest('https://www.otoame.top/api/patch/resource/download/access', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: JSON.stringify(body)
  })

const validInput = { patchId: 7, resourceId: 11, linkId: 21 }

const expectPrivateNoStore = (response: Response) => {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
}

const expectSafeBusyResponse = async (response: Response) => {
  expect(response.status).toBe(503)
  expect(response.headers.get('retry-after')).toBe('1')
  expectPrivateNoStore(response)
  const body = await response.json()
  expect(body).toBe('获取下载链接繁忙，请稍后再试')
  return body as string
}

describe('resource download access grant API', () => {
  beforeEach(() => {
    prismaMocks.patch_resource.findMany.mockReset()
    prismaMocks.patch_resource_link.findFirst.mockReset()
    prismaMocks.patch_resource_access.findMany.mockReset()
    prismaMocks.patch_resource_access.findFirst.mockReset()
    prismaMocks.patch_resource_access.create.mockReset()
    prismaMocks.patch_resource_access_grant.findMany.mockReset()
    prismaMocks.patch_resource_access.findMany.mockResolvedValue([])
    prismaMocks.patch_resource_access.findFirst.mockResolvedValue(null)
    prismaMocks.patch_resource_access.create.mockResolvedValue({
      expires: EXPIRES
    })
    prismaMocks.patch_resource_access_grant.findMany.mockResolvedValue([])
    authMocks.verifyHeaderCookie.mockReset()
    authMocks.verifyHeaderCookie.mockResolvedValue(null)
    actorMocks.getResourceAccessActor.mockClear()
    grantMocks.resolveResourceAccessGrant.mockReset()
    grantMocks.resolveResourceAccessGrant.mockResolvedValue({
      kind: 'resource_granted',
      expires: EXPIRES
    })
    rateLimitMocks.checkResourceAccessActionRateLimit.mockReset()
    rateLimitMocks.checkResourceAccessActionRateLimit.mockResolvedValue({
      allowed: true
    })
    visibilityMocks.getPatchVisibilityWhere.mockReset()
    visibilityMocks.getPatchVisibilityWhere.mockResolvedValue({
      content_limit: 'sfw'
    })
  })

  it('keeps anonymous list links safe and skips both access delegates without identity', async () => {
    const { getPatchResource } = await import('~/app/api/patch/resource/get')
    prismaMocks.patch_resource.findMany.mockResolvedValueOnce([resourceRow()])

    const resources = await getPatchResource({ patchId: 7 }, { uid: 0 })

    expect(resources[0].links[0]).toEqual({
      id: 21,
      storage: 'user',
      size: '1 GB',
      hash: 'hash-21',
      sortOrder: 1,
      download: 5,
      revealed: false
    })
    expect(resources[0].links[0]).not.toHaveProperty('content')
    expect(resources[0].links[0]).not.toHaveProperty('code')
    expect(resources[0].links[0]).not.toHaveProperty('password')
    expect(
      prismaMocks.patch_resource_access_grant.findMany
    ).not.toHaveBeenCalled()
    expect(prismaMocks.patch_resource_access.findMany).not.toHaveBeenCalled()
  })

  it('marks every mirror of an active user grant obtained and only the active event revealed', async () => {
    const { getPatchResource } = await import('~/app/api/patch/resource/get')
    prismaMocks.patch_resource.findMany.mockResolvedValueOnce([
      resourceRow([previewLink(21, 1), previewLink(22, 2)])
    ])
    prismaMocks.patch_resource_access_grant.findMany.mockResolvedValueOnce([
      { resource_id: 11, expires: EXPIRES }
    ])
    prismaMocks.patch_resource_access.findMany.mockResolvedValueOnce([
      { link_id: 21 }
    ])

    const resources = await getPatchResource({ patchId: 7 }, { uid: 1007 })

    expect(
      prismaMocks.patch_resource_access_grant.findMany
    ).toHaveBeenCalledWith({
      where: {
        actor_key: 'user:1007',
        resource_id: { in: [11] },
        expires: { gt: expect.any(Date) }
      },
      select: { resource_id: true, expires: true }
    })
    expect(prismaMocks.patch_resource_access.findMany).toHaveBeenCalledWith({
      where: {
        actor_type: 'user',
        user_id: 1007,
        link_id: { in: [21, 22] },
        expires: { gt: expect.any(Date) }
      },
      select: { link_id: true }
    })
    expect(resources[0].links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 21,
          obtained: true,
          obtainedExpiresAt: EXPIRES.toISOString(),
          revealed: true
        }),
        expect.objectContaining({
          id: 22,
          obtained: true,
          obtainedExpiresAt: EXPIRES.toISOString(),
          revealed: false
        })
      ])
    )
    for (const link of resources[0].links) {
      expect(link).not.toHaveProperty('content')
      expect(link).not.toHaveProperty('code')
      expect(link).not.toHaveProperty('password')
    }
  })

  it('uses the visitor actor key and typed visitor event where on the private list route', async () => {
    const { GET } = await import('~/app/api/patch/resource/route')
    prismaMocks.patch_resource.findMany.mockResolvedValueOnce([resourceRow()])
    prismaMocks.patch_resource_access_grant.findMany.mockResolvedValueOnce([
      { resource_id: 11, expires: EXPIRES }
    ])
    prismaMocks.patch_resource_access.findMany.mockResolvedValueOnce([
      { link_id: 21 }
    ])

    const response = await GET(
      new NextRequest('https://www.otoame.top/api/patch/resource?patchId=7', {
        headers: {
          Cookie: `kun-resource-access-token=${VISITOR_TOKEN}`
        }
      })
    )

    expect(
      prismaMocks.patch_resource_access_grant.findMany
    ).toHaveBeenCalledWith({
      where: {
        actor_key: `visitor:${VISITOR_TOKEN}`,
        resource_id: { in: [11] },
        expires: { gt: expect.any(Date) }
      },
      select: { resource_id: true, expires: true }
    })
    expect(prismaMocks.patch_resource_access.findMany).toHaveBeenCalledWith({
      where: {
        actor_type: 'visitor',
        visitor_token: VISITOR_TOKEN,
        link_id: { in: [21] },
        expires: { gt: expect.any(Date) }
      },
      select: { link_id: true }
    })
    await expect(response.json()).resolves.toMatchObject([
      {
        links: [
          {
            id: 21,
            obtained: true,
            obtainedExpiresAt: EXPIRES.toISOString(),
            revealed: true
          }
        ]
      }
    ])
    expectPrivateNoStore(response)
  })

  it('returns a resource_granted visitor quota only for a guarded galgame resource', async () => {
    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { POST } = await import(
      '~/app/api/patch/resource/download/access/route'
    )
    prismaMocks.patch_resource_link.findFirst.mockResolvedValueOnce(
      accessLink()
    )
    grantMocks.resolveResourceAccessGrant.mockResolvedValueOnce({
      kind: 'resource_granted',
      expires: EXPIRES,
      quota: QUOTA
    })

    const response = await POST(jsonRequest(validInput))

    expect(response.status).toBe(200)
    expectPrivateNoStore(response)
    expect(response.headers.get('set-cookie')).toContain(
      'kun-resource-access-token='
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
        kind: 'resource_granted',
        actorType: 'visitor',
        cost: 0,
        obtainedExpiresAt: EXPIRES.toISOString()
      },
      quota: QUOTA
    })
    expect(grantMocks.resolveResourceAccessGrant).toHaveBeenCalledWith({
      actor: expect.objectContaining({ actorType: 'visitor' }),
      patchId: 7,
      resourceId: 11,
      linkId: 21,
      storage: 'user',
      section: 'galgame',
      now: expect.any(Date)
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
        }
      }
    })
    expect(prismaMocks.patch_resource_access.findFirst).not.toHaveBeenCalled()
    expect(prismaMocks.patch_resource_access.create).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
    logSpy.mockRestore()
  })

  it.each(['Cache-Control', 'cache-control', 'CaChE-CoNtRoL'])(
    'prevents a caller %s header from overriding the access no-store policy',
    async (cacheControlHeader) => {
      const { resourceAccessJson } = await import(
        '~/app/api/patch/resource/download/access/response'
      )

      const response = resourceAccessJson('ok', 201, {
        [cacheControlHeader]: 'public, max-age=86400',
        'X-Resource-Test': 'kept'
      })

      expect(response.status).toBe(201)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(response.headers.get('x-resource-test')).toBe('kept')
    }
  )

  it('strips an injected visitor quota from logged-in resource_granted responses', async () => {
    const { POST } = await import(
      '~/app/api/patch/resource/download/access/route'
    )
    authMocks.verifyHeaderCookie.mockResolvedValueOnce({
      uid: 1007,
      name: 'Saya',
      role: 1
    })
    prismaMocks.patch_resource_link.findFirst.mockResolvedValueOnce(
      accessLink()
    )
    grantMocks.resolveResourceAccessGrant.mockResolvedValueOnce({
      kind: 'resource_granted',
      expires: EXPIRES,
      quota: QUOTA
    })

    const response = await POST(jsonRequest(validInput))
    const body = await response.json()

    expect(body.access).toEqual({
      kind: 'resource_granted',
      actorType: 'user',
      cost: 0,
      obtainedExpiresAt: EXPIRES.toISOString()
    })
    expect(body).not.toHaveProperty('quota')
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('strips an injected visitor quota from patch resource responses', async () => {
    const { POST } = await import(
      '~/app/api/patch/resource/download/access/route'
    )
    prismaMocks.patch_resource_link.findFirst.mockResolvedValueOnce(
      accessLink('patch')
    )
    grantMocks.resolveResourceAccessGrant.mockResolvedValueOnce({
      kind: 'resource_granted',
      expires: EXPIRES,
      quota: QUOTA
    })

    const response = await POST(jsonRequest(validInput))
    const body = await response.json()

    expect(body.access.kind).toBe('resource_granted')
    expect(body).not.toHaveProperty('quota')
    expect(grantMocks.resolveResourceAccessGrant).toHaveBeenCalledWith(
      expect.objectContaining({ section: 'patch' })
    )
  })

  it.each(['link_revealed', 'reused'] as const)(
    'returns %s without quota and only logs a manual reuse',
    async (kind) => {
      const logSpy = vi
        .spyOn(console, 'info')
        .mockImplementation(() => undefined)
      const { POST } = await import(
        '~/app/api/patch/resource/download/access/route'
      )
      prismaMocks.patch_resource_link.findFirst.mockResolvedValueOnce(
        accessLink()
      )
      grantMocks.resolveResourceAccessGrant.mockResolvedValueOnce({
        kind,
        expires: EXPIRES,
        quota: QUOTA
      })

      const response = await POST(jsonRequest(validInput))
      const body = await response.json()

      expect(body.access.kind).toBe(kind)
      expect(body).not.toHaveProperty('quota')
      if (kind === 'reused') {
        expect(logSpy).toHaveBeenCalledTimes(1)
        expect(logSpy).toHaveBeenCalledWith('resource-access-outcome', {
          operation: 'access',
          outcome: 'manual_reused',
          actorType: 'visitor',
          section: 'galgame'
        })
      } else {
        expect(logSpy).not.toHaveBeenCalled()
      }
      logSpy.mockRestore()
    }
  )

  it('returns a no-store 400 before creating an actor or visitor cookie', async () => {
    const { POST } = await import(
      '~/app/api/patch/resource/download/access/route'
    )

    const response = await POST(
      jsonRequest({ patchId: 0, resourceId: 11, linkId: 21 })
    )

    expect(response.status).toBe(400)
    expectPrivateNoStore(response)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(actorMocks.getResourceAccessActor).not.toHaveBeenCalled()
    expect(authMocks.verifyHeaderCookie).not.toHaveBeenCalled()
    expect(visibilityMocks.getPatchVisibilityWhere).not.toHaveBeenCalled()
    expect(grantMocks.resolveResourceAccessGrant).not.toHaveBeenCalled()
  })

  it('rate limits access after actor creation and before visibility or service work', async () => {
    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { POST } = await import(
      '~/app/api/patch/resource/download/access/route'
    )
    rateLimitMocks.checkResourceAccessActionRateLimit.mockResolvedValueOnce({
      allowed: false,
      retryAfterMs: 1501,
      message: '获取下载链接过于频繁，请 2 秒后再试'
    })

    const response = await POST(jsonRequest(validInput))

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('2')
    expectPrivateNoStore(response)
    expect(response.headers.get('set-cookie')).toContain(
      'kun-resource-access-token='
    )
    await expect(response.json()).resolves.toBe(
      '获取下载链接过于频繁，请 2 秒后再试'
    )
    expect(
      rateLimitMocks.checkResourceAccessActionRateLimit
    ).toHaveBeenCalledTimes(1)
    expect(
      rateLimitMocks.checkResourceAccessActionRateLimit
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'visitor',
        shouldSetVisitorCookie: true
      })
    )
    expect(visibilityMocks.getPatchVisibilityWhere).not.toHaveBeenCalled()
    expect(prismaMocks.patch_resource_link.findFirst).not.toHaveBeenCalled()
    expect(grantMocks.resolveResourceAccessGrant).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith('resource-access-outcome', {
      operation: 'access',
      outcome: 'rate_limited',
      actorType: 'visitor'
    })
    logSpy.mockRestore()
  })

  it('returns a no-store 404 with a first-visitor cookie and no grant or log', async () => {
    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { POST } = await import(
      '~/app/api/patch/resource/download/access/route'
    )
    prismaMocks.patch_resource_link.findFirst.mockResolvedValueOnce(null)

    const response = await POST(jsonRequest(validInput))

    expect(response.status).toBe(404)
    expectPrivateNoStore(response)
    expect(response.headers.get('set-cookie')).toContain(
      'kun-resource-access-token='
    )
    await expect(response.json()).resolves.toBe('未找到对应资源链接')
    expect(grantMocks.resolveResourceAccessGrant).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
    logSpy.mockRestore()
  })

  it.each([
    {
      window: 'daily' as const,
      retryAfterSeconds: 61,
      message: '今日游客获取次数已达上限，登录后可继续获取，或 2 分钟后再试',
      outcome: 'daily_limited'
    },
    {
      window: 'weekly' as const,
      retryAfterSeconds: 3600,
      message: '本周游客获取次数已达上限，登录后可继续获取，或 1 小时后再试',
      outcome: 'weekly_limited'
    }
  ])(
    'returns a safe $window visitor limit with Retry-After and one refusal log',
    async ({ window, retryAfterSeconds, message, outcome }) => {
      const logSpy = vi
        .spyOn(console, 'info')
        .mockImplementation(() => undefined)
      const { POST } = await import(
        '~/app/api/patch/resource/download/access/route'
      )
      prismaMocks.patch_resource_link.findFirst.mockResolvedValueOnce(
        accessLink()
      )
      grantMocks.resolveResourceAccessGrant.mockResolvedValueOnce({
        kind: 'limited',
        window,
        retryAfterSeconds,
        remaining: { daily: 2, weekly: 0 },
        resetsAt: QUOTA.resetsAt
      })

      const response = await POST(jsonRequest(validInput))

      expect(response.status).toBe(429)
      expect(response.headers.get('retry-after')).toBe(
        String(retryAfterSeconds)
      )
      expectPrivateNoStore(response)
      expect(response.headers.get('set-cookie')).toContain(
        'kun-resource-access-token='
      )
      const body = await response.json()
      expect(body).toBe(message)
      expect(body).not.toContain('https://')
      expect(body).not.toContain('11')
      expect(body).not.toContain('21')
      expect(logSpy).toHaveBeenCalledTimes(1)
      expect(logSpy).toHaveBeenCalledWith('resource-access-outcome', {
        operation: 'access',
        outcome,
        actorType: 'visitor',
        section: 'galgame'
      })
      logSpy.mockRestore()
    }
  )

  it('returns one safe logged 503 when the grant transaction stays busy', async () => {
    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { ResourceAccessGrantBusyError } = await import(
      '~/app/api/patch/resource/download/access/grant'
    )
    const { POST } = await import(
      '~/app/api/patch/resource/download/access/route'
    )
    prismaMocks.patch_resource_link.findFirst.mockResolvedValueOnce(
      accessLink()
    )
    grantMocks.resolveResourceAccessGrant.mockRejectedValueOnce(
      new ResourceAccessGrantBusyError()
    )

    const response = await POST(jsonRequest(validInput))

    const body = await expectSafeBusyResponse(response)
    expect(response.headers.get('set-cookie')).toContain(
      'kun-resource-access-token='
    )
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith('resource-access-outcome', {
      operation: 'access',
      outcome: 'manual_failed',
      actorType: 'visitor'
    })
    expect(body).not.toContain('P2034')
    expect(body).not.toContain('https://')
    expect(body).not.toContain('11')
    logSpy.mockRestore()
  })

  it('catches an unknown grant failure without leaking internals and logs once', async () => {
    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { POST } = await import(
      '~/app/api/patch/resource/download/access/route'
    )
    prismaMocks.patch_resource_link.findFirst.mockResolvedValueOnce(
      accessLink()
    )
    grantMocks.resolveResourceAccessGrant.mockRejectedValueOnce(
      new Error('P2034 resource 11 https://pan.example.com/secret')
    )

    const response = await POST(jsonRequest(validInput))

    const body = await expectSafeBusyResponse(response)
    expect(response.headers.get('set-cookie')).toContain(
      'kun-resource-access-token='
    )
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith('resource-access-outcome', {
      operation: 'access',
      outcome: 'manual_failed',
      actorType: 'visitor'
    })
    expect(body).not.toContain('P2034')
    expect(body).not.toContain('https://')
    expect(body).not.toContain('11')
    logSpy.mockRestore()
  })

  it('rejects an unknown resource section before grant with one safe logged 503', async () => {
    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { POST } = await import(
      '~/app/api/patch/resource/download/access/route'
    )
    prismaMocks.patch_resource_link.findFirst.mockResolvedValueOnce(
      accessLink('secret-internal-section')
    )

    const response = await POST(jsonRequest(validInput))

    const body = await expectSafeBusyResponse(response)
    expect(response.headers.get('set-cookie')).toContain(
      'kun-resource-access-token='
    )
    expect(grantMocks.resolveResourceAccessGrant).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith('resource-access-outcome', {
      operation: 'access',
      outcome: 'manual_failed',
      actorType: 'visitor'
    })
    expect(body).not.toContain('secret-internal-section')
    logSpy.mockRestore()
  })

  it('catches visibility failures in the post-actor branch with cookie and one safe log', async () => {
    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { POST } = await import(
      '~/app/api/patch/resource/download/access/route'
    )
    visibilityMocks.getPatchVisibilityWhere.mockRejectedValueOnce(
      new Error('visibility query exposed internal state')
    )

    const response = await POST(jsonRequest(validInput))

    await expectSafeBusyResponse(response)
    expect(response.headers.get('set-cookie')).toContain(
      'kun-resource-access-token='
    )
    expect(prismaMocks.patch_resource_link.findFirst).not.toHaveBeenCalled()
    expect(grantMocks.resolveResourceAccessGrant).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith('resource-access-outcome', {
      operation: 'access',
      outcome: 'manual_failed',
      actorType: 'visitor'
    })
    logSpy.mockRestore()
  })
})
