import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { ResourceAccessActor } from '~/app/api/patch/resource/download/access/actor'

const prismaMocks = vi.hoisted(() => ({
  patch_resource_access_grant: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn()
  },
  patch_resource_access: {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn()
  },
  $transaction: vi.fn()
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

const restoreServiceMocks = vi.hoisted(() => ({
  restorePatchResourceLinks: vi.fn()
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

vi.mock(
  '~/app/api/patch/resource/download/access/restore/service',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('~/app/api/patch/resource/download/access/restore/service')
      >()
    restoreServiceMocks.restorePatchResourceLinks.mockImplementation(
      actual.restorePatchResourceLinks
    )
    return {
      ...actual,
      restorePatchResourceLinks: restoreServiceMocks.restorePatchResourceLinks
    }
  }
)

vi.mock('~/app/api/utils/getPatchVisibilityWhere', () => ({
  getPatchVisibilityWhere: visibilityMocks.getPatchVisibilityWhere
}))

const VISITOR_TOKEN = '123e4567-e89b-42d3-a456-426614174000'
const GRANT_EXPIRES = new Date('2026-07-11T00:00:00.000Z')
const NOW = new Date('2026-07-10T12:00:00.000Z')
const visibilityWhere = {
  content_limit: 'sfw',
  tag: { none: { tag_id: { in: [3, 5] } } }
}

const visitorActor: ResourceAccessActor = {
  actorType: 'visitor',
  uid: 0,
  visitorToken: VISITOR_TOKEN,
  ipHash: '',
  shouldSetVisitorCookie: false
}

const userActor: ResourceAccessActor = {
  actorType: 'user',
  uid: 1007,
  visitorToken: '',
  ipHash: '',
  shouldSetVisitorCookie: false
}

const sensitiveLink21 = {
  id: 21,
  storage: 'user',
  size: '2 GB',
  content: 'https://pan.example.com/share/21',
  code: 'abcd',
  password: 'secret-21',
  hash: 'hash-21'
}

const sensitiveLink22 = {
  id: 22,
  storage: 's3',
  size: '3 GB',
  content: 'https://storage.example.com/share/22',
  code: '',
  password: 'secret-22',
  hash: 'hash-22'
}

const RESTORE_LINK_SELECT = {
  link: {
    select: {
      id: true,
      storage: true,
      size: true,
      content: true,
      code: true,
      password: true,
      hash: true
    }
  }
}

const jsonRequest = (body: unknown, cookie = '') =>
  new NextRequest(
    'https://www.otoame.top/api/patch/resource/download/access/restore',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {})
      },
      body: JSON.stringify(body)
    }
  )

const validInput = { patchId: 7, resourceId: 11, linkIds: [21, 22] }

const expectPrivateNoStore = (response: Response) => {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
}

const expectNoRestoreWrites = () => {
  for (const delegate of [
    prismaMocks.patch_resource_access_grant,
    prismaMocks.patch_resource_access
  ]) {
    expect(delegate.create).not.toHaveBeenCalled()
    expect(delegate.update).not.toHaveBeenCalled()
    expect(delegate.updateMany).not.toHaveBeenCalled()
    expect(delegate.upsert).not.toHaveBeenCalled()
    expect(delegate.delete).not.toHaveBeenCalled()
    expect(delegate.deleteMany).not.toHaveBeenCalled()
  }
  expect(prismaMocks.$transaction).not.toHaveBeenCalled()
  expect(grantMocks.resolveResourceAccessGrant).not.toHaveBeenCalled()
}

const expectedAccessQuery = (
  actorWhere: Record<string, unknown>,
  linkIds: number[]
) => ({
  where: {
    ...actorWhere,
    patch_id: 7,
    resource_id: 11,
    link_id: { in: linkIds },
    expires: { gte: GRANT_EXPIRES },
    link: { resource_id: 11 },
    resource: {
      status: 0,
      patch_id: 7,
      patch: {
        id: 7,
        status: 0,
        ...visibilityWhere
      }
    }
  },
  select: RESTORE_LINK_SELECT
})

describe('resource access restore service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMocks.patch_resource_access_grant.findUnique.mockResolvedValue({
      expires: GRANT_EXPIRES
    })
    prismaMocks.patch_resource_access.findMany.mockResolvedValue([])
    authMocks.verifyHeaderCookie.mockResolvedValue(null)
    visibilityMocks.getPatchVisibilityWhere.mockResolvedValue(visibilityWhere)
  })

  it('restores only requested visitor mirrors whose reveal event covers the full grant', async () => {
    const { restorePatchResourceLinks } = await import(
      '~/app/api/patch/resource/download/access/restore/service'
    )
    prismaMocks.patch_resource_access.findMany.mockResolvedValueOnce([
      { link: sensitiveLink21 }
    ])

    const result = await restorePatchResourceLinks(
      validInput,
      visibilityWhere,
      visitorActor,
      NOW
    )

    expect(result).toEqual({
      links: [sensitiveLink21],
      obtainedExpiresAt: GRANT_EXPIRES.toISOString()
    })
    expect(
      prismaMocks.patch_resource_access_grant.findUnique
    ).toHaveBeenCalledWith({
      where: {
        actor_key_resource_id: {
          actor_key: `visitor:${VISITOR_TOKEN}`,
          resource_id: 11
        }
      },
      select: { expires: true }
    })
    expect(prismaMocks.patch_resource_access.findMany).toHaveBeenCalledWith(
      expectedAccessQuery(
        { actor_type: 'visitor', visitor_token: VISITOR_TOKEN },
        [21, 22]
      )
    )
    expectNoRestoreWrites()
  })

  it('uses the exact user identity and complete visibility constraints', async () => {
    const { restorePatchResourceLinks } = await import(
      '~/app/api/patch/resource/download/access/restore/service'
    )
    prismaMocks.patch_resource_access.findMany.mockResolvedValueOnce([
      { link: sensitiveLink22 }
    ])

    const result = await restorePatchResourceLinks(
      validInput,
      visibilityWhere,
      userActor,
      NOW
    )

    expect(result.links).toEqual([sensitiveLink22])
    expect(
      prismaMocks.patch_resource_access_grant.findUnique
    ).toHaveBeenCalledWith({
      where: {
        actor_key_resource_id: {
          actor_key: 'user:1007',
          resource_id: 11
        }
      },
      select: { expires: true }
    })
    expect(prismaMocks.patch_resource_access.findMany).toHaveBeenCalledWith(
      expectedAccessQuery({ actor_type: 'user', user_id: 1007 }, [21, 22])
    )
    expectNoRestoreWrites()
  })

  it('deduplicates historical events and orders links like the requested IDs', async () => {
    const { restorePatchResourceLinks } = await import(
      '~/app/api/patch/resource/download/access/restore/service'
    )
    prismaMocks.patch_resource_access.findMany.mockResolvedValueOnce([
      { link: sensitiveLink21 },
      { link: sensitiveLink21 },
      { link: sensitiveLink22 }
    ])

    const result = await restorePatchResourceLinks(
      { patchId: 7, resourceId: 11, linkIds: [22, 21] },
      visibilityWhere,
      visitorActor,
      NOW
    )

    expect(result.links).toEqual([sensitiveLink22, sensitiveLink21])
    expectNoRestoreWrites()
  })

  it('does not restore unrequested or unrevealed mirrors from an active grant', async () => {
    const { restorePatchResourceLinks } = await import(
      '~/app/api/patch/resource/download/access/restore/service'
    )
    prismaMocks.patch_resource_access.findMany.mockResolvedValueOnce([
      { link: sensitiveLink21 }
    ])

    const result = await restorePatchResourceLinks(
      validInput,
      visibilityWhere,
      visitorActor,
      NOW
    )

    expect(result.links).toEqual([sensitiveLink21])
    expect(result.links).not.toContainEqual(sensitiveLink22)
    expect(prismaMocks.patch_resource_access.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          link_id: { in: [21, 22] },
          expires: { gte: GRANT_EXPIRES }
        })
      })
    )
    expectNoRestoreWrites()
  })

  it.each([
    ['missing', null],
    ['expired', { expires: NOW }]
  ])(
    'returns no links for a %s grant without reading access events',
    async (_, grant) => {
      const { restorePatchResourceLinks } = await import(
        '~/app/api/patch/resource/download/access/restore/service'
      )
      prismaMocks.patch_resource_access_grant.findUnique.mockResolvedValueOnce(
        grant
      )

      const result = await restorePatchResourceLinks(
        validInput,
        visibilityWhere,
        visitorActor,
        NOW
      )

      expect(result).toEqual({ links: [], obtainedExpiresAt: null })
      expect(prismaMocks.patch_resource_access.findMany).not.toHaveBeenCalled()
      expectNoRestoreWrites()
    }
  )

  it('returns no sensitive fields when the resource or patch is not visible', async () => {
    const { restorePatchResourceLinks } = await import(
      '~/app/api/patch/resource/download/access/restore/service'
    )
    prismaMocks.patch_resource_access.findMany.mockResolvedValueOnce([])

    const result = await restorePatchResourceLinks(
      validInput,
      visibilityWhere,
      visitorActor,
      NOW
    )

    expect(result).toEqual({
      links: [],
      obtainedExpiresAt: GRANT_EXPIRES.toISOString()
    })
    expect(JSON.stringify(result)).not.toContain('https://')
    expect(prismaMocks.patch_resource_access.findMany).toHaveBeenCalledWith(
      expectedAccessQuery(
        { actor_type: 'visitor', visitor_token: VISITOR_TOKEN },
        [21, 22]
      )
    )
    expectNoRestoreWrites()
  })
})

describe('resource access restore route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMocks.verifyHeaderCookie.mockResolvedValue(null)
    visibilityMocks.getPatchVisibilityWhere.mockResolvedValue(visibilityWhere)
  })

  it.each([
    ['empty link IDs', { patchId: 7, resourceId: 11, linkIds: [] }],
    [
      '51 link IDs',
      {
        patchId: 7,
        resourceId: 11,
        linkIds: Array.from({ length: 51 }, (_, index) => index + 1)
      }
    ],
    [
      '51 duplicate link IDs before transform',
      { patchId: 7, resourceId: 11, linkIds: Array(51).fill(21) }
    ],
    ['non-integer link ID', { patchId: 7, resourceId: 11, linkIds: [21.5] }]
  ])(
    'returns a silent no-store 400 for %s before actor creation',
    async (_, body) => {
      const logSpy = vi
        .spyOn(console, 'info')
        .mockImplementation(() => undefined)
      const { POST } = await import(
        '~/app/api/patch/resource/download/access/restore/route'
      )

      const response = await POST(jsonRequest(body))

      expect(response.status).toBe(400)
      expectPrivateNoStore(response)
      expect(response.headers.get('set-cookie')).toBeNull()
      expect(authMocks.verifyHeaderCookie).not.toHaveBeenCalled()
      expect(actorMocks.getResourceAccessActor).not.toHaveBeenCalled()
      expect(visibilityMocks.getPatchVisibilityWhere).not.toHaveBeenCalled()
      expect(
        restoreServiceMocks.restorePatchResourceLinks
      ).not.toHaveBeenCalled()
      expect(logSpy).not.toHaveBeenCalled()
      expectNoRestoreWrites()
      logSpy.mockRestore()
    }
  )

  it('deduplicates at most 50 raw IDs in first-seen order before service', async () => {
    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { POST } = await import(
      '~/app/api/patch/resource/download/access/restore/route'
    )
    const rawLinkIds = Array.from({ length: 50 }, (_, index) =>
      index % 3 === 0 ? 22 : index % 3 === 1 ? 21 : 22
    )
    restoreServiceMocks.restorePatchResourceLinks.mockResolvedValueOnce({
      links: [],
      obtainedExpiresAt: GRANT_EXPIRES.toISOString()
    })

    const response = await POST(
      jsonRequest({ patchId: 7, resourceId: 11, linkIds: rawLinkIds })
    )

    expect(response.status).toBe(200)
    expect(restoreServiceMocks.restorePatchResourceLinks).toHaveBeenCalledWith(
      { patchId: 7, resourceId: 11, linkIds: [22, 21] },
      visibilityWhere,
      expect.objectContaining({ actorType: 'visitor' })
    )
    expect(logSpy).toHaveBeenCalledTimes(1)
    logSpy.mockRestore()
  })

  it('returns no-store and no links for an expired grant as a normal visitor success', async () => {
    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { POST } = await import(
      '~/app/api/patch/resource/download/access/restore/route'
    )
    restoreServiceMocks.restorePatchResourceLinks.mockResolvedValueOnce({
      links: [],
      obtainedExpiresAt: null
    })

    const response = await POST(
      jsonRequest({ patchId: 7, resourceId: 11, linkIds: [21] })
    )

    expect(response.status).toBe(200)
    expectPrivateNoStore(response)
    expect(response.headers.get('set-cookie')).toContain(
      'kun-resource-access-token='
    )
    await expect(response.json()).resolves.toEqual({
      links: [],
      obtainedExpiresAt: null
    })
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith('resource-access-outcome', {
      operation: 'restore',
      outcome: 'restore_succeeded',
      actorType: 'visitor'
    })
    expectNoRestoreWrites()
    logSpy.mockRestore()
  })

  it('does not set a visitor cookie for a logged-in successful restore', async () => {
    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { POST } = await import(
      '~/app/api/patch/resource/download/access/restore/route'
    )
    authMocks.verifyHeaderCookie.mockResolvedValueOnce({
      uid: 1007,
      name: 'Saya',
      role: 1
    })
    restoreServiceMocks.restorePatchResourceLinks.mockResolvedValueOnce({
      links: [sensitiveLink21],
      obtainedExpiresAt: GRANT_EXPIRES.toISOString()
    })

    const response = await POST(
      jsonRequest({ patchId: 7, resourceId: 11, linkIds: [21] })
    )

    expect(response.status).toBe(200)
    expectPrivateNoStore(response)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith('resource-access-outcome', {
      operation: 'restore',
      outcome: 'restore_succeeded',
      actorType: 'user'
    })
    expectNoRestoreWrites()
    logSpy.mockRestore()
  })

  it.each(['visibility', 'service'] as const)(
    'maps a %s failure to one safe no-store 503 after actor creation',
    async (failurePoint) => {
      const logSpy = vi
        .spyOn(console, 'info')
        .mockImplementation(() => undefined)
      const { POST } = await import(
        '~/app/api/patch/resource/download/access/restore/route'
      )
      if (failurePoint === 'visibility') {
        visibilityMocks.getPatchVisibilityWhere.mockRejectedValueOnce(
          new Error(
            'visibility leaked visitor token and https://secret.example.com'
          )
        )
      } else {
        restoreServiceMocks.restorePatchResourceLinks.mockRejectedValueOnce(
          new Error('P2034 actorKey visitor:secret resource 11 link 21')
        )
      }

      const response = await POST(
        jsonRequest({ patchId: 7, resourceId: 11, linkIds: [21] })
      )

      expect(response.status).toBe(503)
      expect(response.headers.get('retry-after')).toBe('1')
      expectPrivateNoStore(response)
      expect(response.headers.get('set-cookie')).toContain(
        'kun-resource-access-token='
      )
      const body = await response.json()
      expect(typeof body).toBe('string')
      expect(body).not.toContain('P2034')
      expect(body).not.toContain('visitor:')
      expect(body).not.toContain('https://')
      expect(body).not.toContain('11')
      expect(body).not.toContain('21')
      expect(logSpy).toHaveBeenCalledTimes(1)
      expect(logSpy).toHaveBeenCalledWith('resource-access-outcome', {
        operation: 'restore',
        outcome: 'restore_failed',
        actorType: 'visitor'
      })
      const loggedFields = logSpy.mock.calls[0]?.[1]
      expect(Object.keys(loggedFields as object).sort()).toEqual([
        'actorType',
        'operation',
        'outcome'
      ])
      expect(JSON.stringify(loggedFields)).not.toContain(VISITOR_TOKEN)
      expect(JSON.stringify(loggedFields)).not.toContain('https://')
      expectNoRestoreWrites()
      logSpy.mockRestore()
    }
  )
})
