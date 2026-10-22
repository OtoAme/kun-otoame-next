import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WORKSPACE_ERRORS as E } from '~/constants/workspace'
import { linkMaintenanceActionSchema } from '~/validations/linkMaintenance'
import {
  workspaceResourceUpdateSchema,
  workspaceResourcesQuerySchema
} from '~/validations/workspace'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  rate: vi.fn()
}))
vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: mocks.auth
}))
vi.mock('~/middleware/_csrf', () => ({ verifyKunCsrf: mocks.csrf }))
vi.mock('~/app/api/patch/resource/link/rateLimit', () => ({
  checkLinkHealthRateLimit: mocks.rate
}))
vi.mock('~/app/api/patch/resource/mutation', () => ({
  ResourceMutationError: class extends Error {
    constructor(
      message: string,
      public readonly status = 409
    ) {
      super(message)
    }
  }
}))
import { ResourceMutationError } from '~/app/api/patch/resource/mutation'
import {
  workspaceBody,
  workspaceJson,
  workspaceQuery,
  workspaceRequest
} from '~/app/api/workspace/http'

const canaries = [
  'URL_CANARY',
  'BODY_CANARY',
  'COOKIE_CANARY',
  'AUTH_CANARY',
  'SQL_CANARY',
  'INBOUND_ID_CANARY'
]
const request = (
  method = 'PUT',
  body: unknown = {},
  path = '/api/workspace/resources/7'
) =>
  new NextRequest(`https://workspace.test${path}?query=URL_CANARY`, {
    method,
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'COOKIE_CANARY',
      Authorization: 'AUTH_CANARY',
      'X-Request-Id': 'INBOUND_ID_CANARY'
    }
  })
const input = () => ({
  name: 'BODY_CANARY',
  section: 'galgame',
  note: '',
  type: ['pc', 'row'],
  language: ['ja'],
  platform: ['windows'],
  baseLinks: [{ id: 2, version: 1 }],
  links: [
    {
      id: 2,
      storage: 'user',
      content: 'https://pan.xunlei.com/s/synthetic-only',
      size: 'BAD_SIZE',
      code: '',
      password: '',
      hash: ''
    }
  ]
})
const requestId = (response: Response) => {
  const id = response.headers.get('x-request-id')
  expect(id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  )
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  return id!
}
const logs = () =>
  JSON.stringify([
    vi.mocked(console.info).mock.calls,
    vi.mocked(console.warn).mock.calls,
    vi.mocked(console.error).mock.calls
  ])
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ uid: 8, role: 1, name: 'BODY_CANARY' })
  mocks.csrf.mockReturnValue(null)
  mocks.rate.mockResolvedValue(null)
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('C1 workspace HTTP feedback and safe correlation', () => {
  it.each(['auth', 'rate', 'service'] as const)(
    'does not misclassify an internal %s SyntaxError as malformed request JSON',
    async (stage) => {
      const failure = new SyntaxError('INTERNAL_SQL_CANARY')
      if (stage === 'auth') mocks.auth.mockRejectedValue(failure)
      if (stage === 'rate') mocks.rate.mockRejectedValue(failure)
      const result = await workspaceRequest(
        request(),
        async () => {
          throw failure
        },
        true
      )
      const id = requestId(result)
      expect(result.status).toBe(503)
      expect(await result.json()).toContain(id)
      expect(console.error).toHaveBeenCalledWith(
        '[Workspace]',
        expect.objectContaining({
          result: 'unavailable',
          status: 503,
          requestId: id
        })
      )
      expect(logs()).not.toContain('CANARY')
    }
  )

  it('records only validated maintenance identifiers, never its note', async () => {
    const req = request(
      'POST',
      {
        action: 'respond',
        note: 'BODY_CANARY',
        patchId: 5,
        resourceId: 7,
        linkId: 2,
        linkVersion: 1,
        maintenanceRevision: 0
      },
      '/api/workspace/maintenance'
    )
    const result = await workspaceRequest(
      req,
      async () => {
        await workspaceBody(req, linkMaintenanceActionSchema)
        return { changed: true }
      },
      true
    )
    const id = requestId(result)
    expect(result.status).toBe(200)
    expect(console.info).toHaveBeenCalledWith(
      '[Workspace]',
      expect.objectContaining({
        requestId: id,
        operation: 'maintenance.action',
        actorId: 8,
        patchId: 5,
        resourceId: 7,
        linkId: 2
      })
    )
    expect(logs()).not.toContain('CANARY')
  })

  it('isolates request IDs and actors across overlapping asynchronous writes', async () => {
    mocks.auth
      .mockResolvedValueOnce({ uid: 8, role: 1 })
      .mockResolvedValueOnce({ uid: 9, role: 3 })
    let release: () => void = () => {}
    const gate = new Promise<void>((done) => {
      release = done
    })
    const first = workspaceRequest(
      request(),
      async () => {
        await gate
        return { saved: true }
      },
      true
    )
    const second = await workspaceRequest(
      request('PUT', {}, '/api/workspace/resources/9'),
      async () => ({ saved: true }),
      true
    )
    release()
    const one = await first
    const firstId = requestId(one)
    const secondId = requestId(second)
    expect(firstId).not.toBe(secondId)
    const records = vi
      .mocked(console.info)
      .mock.calls.map(
        ([, value]) =>
          value as { requestId: string; resourceId: number; actorId: number }
      )
    expect(records).toEqual([
      expect.objectContaining({
        requestId: secondId,
        resourceId: 9,
        actorId: 9
      }),
      expect.objectContaining({ requestId: firstId, resourceId: 7, actorId: 8 })
    ])
  })

  it('returns server-generated IDs on ordinary reads without success-poll logging', async () => {
    const result = await workspaceRequest(request('GET'), async (user) => ({
      id: user.id
    }))
    requestId(result)
    expect(await result.json()).toEqual({ id: 8 })
    expect(logs()).toBe('[[],[],[]]')
    requestId(workspaceJson({ ok: true }))
  })

  it('logs a committed write outcome with matching request ID and safe numeric target', async () => {
    const result = await workspaceRequest(
      request(),
      async () => ({ saved: true }),
      true
    )
    const id = requestId(result)
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({ saved: true })
    expect(console.info).toHaveBeenCalledWith(
      '[Workspace]',
      expect.objectContaining({
        requestId: id,
        operation: 'resource.update',
        route: '/api/workspace/resources/[id]',
        status: 200,
        result: 'success',
        actorId: 8,
        resourceId: 7
      })
    )
    for (const canary of canaries) expect(logs()).not.toContain(canary)
  })

  it.each(['anonymous', 'csrf', 'rate'] as const)(
    'keeps %s denial before parsing/business work with IDs and original status',
    async (kind) => {
      if (kind === 'anonymous') mocks.auth.mockResolvedValue(null)
      if (kind === 'csrf') mocks.csrf.mockReturnValue('denied')
      if (kind === 'rate') mocks.rate.mockResolvedValue(13)
      const run = vi.fn(async () => ({ saved: true }))
      const result = await workspaceRequest(request(), run, true)
      requestId(result)
      expect(result.status).toBe(
        kind === 'anonymous' ? 401 : kind === 'csrf' ? 403 : 429
      )
      expect(run).not.toHaveBeenCalled()
      if (kind === 'rate') expect(result.headers.get('retry-after')).toBe('13')
      for (const canary of canaries) expect(logs()).not.toContain(canary)
    }
  )

  it('returns safe actionable size feedback from actual strict validation with zero business writes', async () => {
    const req = request('PUT', input())
    const write = vi.fn()
    const result = await workspaceRequest(
      req,
      async () =>
        write(await workspaceBody(req, workspaceResourceUpdateSchema)),
      true
    )
    const id = requestId(result)
    expect(result.status).toBe(400)
    const message = await result.json()
    expect(message).toMatch(/链接 #1.*大小.*MB.*GB/)
    expect(write).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith(
      '[Workspace]',
      expect.objectContaining({
        requestId: id,
        validationPaths: ['links.0.size']
      })
    )
    for (const canary of [...canaries, 'BAD_SIZE']) {
      expect(message).not.toContain(canary)
      expect(logs()).not.toContain(canary)
    }
  })

  it('gives safe query-field feedback without logging query strings', async () => {
    const req = request('GET', undefined, '/api/workspace/resources')
    req.nextUrl.searchParams.set('page', '0')
    const result = await workspaceRequest(req, async () =>
      workspaceQuery(req, workspaceResourcesQuerySchema)
    )
    requestId(result)
    expect(result.status).toBe(400)
    expect(await result.json()).toContain('页码')
    expect(logs()).not.toContain('URL_CANARY')
  })

  it.each([404, 409])(
    'preserves known domain status %s and string body',
    async (status) => {
      const result = await workspaceRequest(
        request(),
        async () => {
          throw new ResourceMutationError(
            status === 404 ? E.not_found.message : E.conflict.message,
            status
          )
        },
        true
      )
      requestId(result)
      expect(result.status).toBe(status)
      expect(typeof (await result.json())).toBe('string')
    }
  )

  it.each(['auth', 'rate', 'service'] as const)(
    'safely correlates an unexpected %s failure without exposing raw exceptions',
    async (stage) => {
      const fail = new Error(
        'SQL_CANARY password=BODY_CANARY https://pan.xunlei.com/s/URL_CANARY'
      )
      if (stage === 'auth') mocks.auth.mockRejectedValue(fail)
      if (stage === 'rate') mocks.rate.mockRejectedValue(fail)
      const result = await workspaceRequest(
        request(),
        async () => {
          throw fail
        },
        true
      )
      const id = requestId(result)
      expect(result.status).toBe(503)
      expect(await result.json()).toContain(id)
      expect(console.error).toHaveBeenCalledWith(
        '[Workspace]',
        expect.objectContaining({
          requestId: id,
          status: 503,
          result: 'unavailable'
        })
      )
      for (const canary of canaries) expect(logs()).not.toContain(canary)
    }
  )

  it('does not echo malformed JSON or unrecognized route fragments', async () => {
    const req = new NextRequest(
      'https://workspace.test/api/workspace/ROUTE_CANARY',
      { method: 'POST', body: '{BODY_CANARY' }
    )
    const result = await workspaceRequest(
      req,
      async () => workspaceBody(req, workspaceResourceUpdateSchema),
      true
    )
    requestId(result)
    expect(result.status).toBe(400)
    expect(await result.json()).toBe(E.invalid_request.message)
    expect(logs()).not.toMatch(/BODY_CANARY|ROUTE_CANARY/)
  })
})
