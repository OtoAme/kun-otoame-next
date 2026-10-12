import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  update: vi.fn(),
  adminUpdate: vi.fn()
}))
vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: mocks.auth
}))
vi.mock('~/app/api/patch/resource/update', () => ({
  updatePatchResource: mocks.update
}))
vi.mock('~/app/api/admin/resource/update', () => ({
  updatePatchResource: mocks.adminUpdate
}))
vi.mock('~/app/api/patch/resource/get', () => ({ getPatchResource: vi.fn() }))
vi.mock('~/app/api/patch/resource/create', () => ({
  createPatchResource: vi.fn()
}))
vi.mock('~/app/api/patch/resource/delete', () => ({ deleteResource: vi.fn() }))
vi.mock('~/app/api/admin/resource/get', () => ({ getPatchResource: vi.fn() }))
vi.mock('~/app/api/admin/resource/delete', () => ({ deleteResource: vi.fn() }))
vi.mock('~/prisma/index', () => ({ prisma: {} }))
vi.mock('~/lib/redis', () => ({
  acquireKvLock: vi.fn(),
  releaseKvLock: vi.fn()
}))
import { PUT as publicPut } from '~/app/api/patch/resource/route'
import { PUT as adminPut } from '~/app/api/admin/resource/route'
import { LINK_HEALTH_ERRORS } from '~/constants/linkHealth'
const valid = () => ({
  resourceId: 10,
  patchId: 20,
  baseLinks: [
    { id: 30, version: 1 },
    { id: 31, version: 2 }
  ],
  section: 'galgame',
  name: 'resource',
  note: '',
  type: ['pc', 'row'],
  language: ['ja'],
  platform: ['windows'],
  links: [
    {
      id: 31,
      storage: 'user',
      size: '1 GB',
      content: 'https://example.test/share',
      code: '',
      password: '',
      hash: ''
    }
  ]
})
const req = (body: unknown) =>
  new NextRequest('https://example.test/api/patch/resource', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ uid: 7, role: 3 })
  mocks.update.mockResolvedValue({ linkChecks: [], links: [] })
  mocks.adminUpdate.mockResolvedValue({ linkChecks: [], links: [] })
})
describe.each([
  { put: publicPut, service: mocks.update },
  { put: adminPut, service: mocks.adminUpdate }
])('stable PUT request boundary', ({ put, service }) => {
  it('accepts a legal desired subset while retaining the complete base', async () => {
    const response = await put(req(valid()))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(service.mock.calls[0][0]).toMatchObject({
      baseLinks: [
        { id: 30, version: 1 },
        { id: 31, version: 2 }
      ],
      links: [{ id: 31 }]
    })
  })
  it.each(['missing', 'duplicate', 'outside'])(
    'rejects %s base before entering service',
    async (kind) => {
      const input = valid()
      if (kind === 'missing') Reflect.deleteProperty(input, 'baseLinks')
      if (kind === 'duplicate') input.baseLinks.push({ ...input.baseLinks[0] })
      if (kind === 'outside') input.links[0].id = 99
      const response = await put(req(input))
      expect(response.status).toBe(400)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(service).not.toHaveBeenCalled()
    }
  )
  it('returns a stale-edit 409 with the accepted string error', async () => {
    service.mockResolvedValue(LINK_HEALTH_ERRORS.resource_conflict.message)
    const response = await put(req(valid()))
    expect(response.status).toBe(409)
    expect(await response.json()).toBe(
      LINK_HEALTH_ERRORS.resource_conflict.message
    )
  })
})
it('lets the publisher submit an unchanged protected slot for locked old-row permission validation', async () => {
  mocks.auth.mockResolvedValue({ uid: 7, role: 2 })
  const input = valid()
  input.links[0].storage = 'touchgal'
  expect((await publicPut(req(input))).status).toBe(200)
  expect(mocks.update).toHaveBeenCalledWith(expect.any(Object), 7, 2)
})
