import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  actionAuth: vi.fn(),
  resource: vi.fn(),
  apply: vi.fn()
}))
vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: mocks.auth
}))
vi.mock('~/utils/actions/verifyHeaderCookie', () => ({
  verifyHeaderCookie: mocks.actionAuth
}))
vi.mock('~/app/api/admin/resource/get', () => ({
  getPatchResource: mocks.resource
}))
vi.mock('~/app/api/admin/resource-apply/get', () => ({
  getPatchResourceApply: mocks.apply
}))
vi.mock('~/app/api/admin/resource/update', () => ({
  updatePatchResource: vi.fn()
}))
vi.mock('~/app/api/admin/resource/delete', () => ({ deleteResource: vi.fn() }))
vi.mock('~/utils/actions/getNSFWHeader', () => ({
  getNSFWHeader: vi.fn(async () => ({}))
}))
import { GET as resource } from '~/app/api/admin/resource/route'
import { GET as apply } from '~/app/api/admin/resource-apply/route'
import { kunGetActions as resourceAction } from '~/app/(site)/admin/resource/actions'
import { kunGetActions as applyAction } from '~/app/(site)/admin/resource-apply/actions'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ uid: 7, role: 3 })
  mocks.actionAuth.mockResolvedValue({ uid: 7, role: 4 })
  mocks.resource.mockResolvedValue({ resources: [], total: 0 })
  mocks.apply.mockResolvedValue({ resources: [], total: 0 })
})
describe('private resource health readers', () => {
  it('validates exact-resource filter without changing the role 3 private API gate', async () => {
    const result = await resource(
      new NextRequest(
        'https://example.test/api/admin/resource?page=1&limit=1&resourceId=17'
      )
    )
    expect(result.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.resource).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 17 }),
      expect.any(Object),
      { uid: 7, role: 3 }
    )
    mocks.resource.mockClear()
    await resource(
      new NextRequest(
        'https://example.test/api/admin/resource?page=1&limit=1&resourceId=17.5'
      )
    )
    expect(mocks.resource).not.toHaveBeenCalled()
    mocks.auth.mockResolvedValue({ uid: 7, role: 2 })
    await resource(
      new NextRequest(
        'https://example.test/api/admin/resource?page=1&limit=1&resourceId=17'
      )
    )
    expect(mocks.resource).not.toHaveBeenCalled()
  })
  it.each([
    { run: resource, service: mocks.resource },
    { run: apply, service: mocks.apply }
  ])(
    'forwards only verified API identity and sets no-store for success and auth failures',
    async ({ run, service }) => {
      const result = await run(
        new NextRequest(
          'https://example.test/api/admin/resource?page=1&limit=20&uid=999&role=4'
        )
      )
      expect(result.headers.get('cache-control')).toBe('private, no-store')
      expect(service).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        { uid: 7, role: 3 }
      )
      mocks.auth.mockResolvedValue(null)
      service.mockClear()
      const denied = await run(
        new NextRequest(
          'https://example.test/api/admin/resource?page=1&limit=20'
        )
      )
      expect(denied.headers.get('cache-control')).toBe('private, no-store')
      expect(service).not.toHaveBeenCalled()
    }
  )

  it.each([
    { run: resourceAction, service: mocks.resource },
    { run: applyAction, service: mocks.apply }
  ])(
    'forwards verified legacy-action identity and retains its original role threshold',
    async ({ run, service }) => {
      await run({ page: 1, limit: 20, search: '', userId: undefined })
      expect(service).toHaveBeenCalledWith(
        expect.any(Object),
        {},
        { uid: 7, role: 4 }
      )
      mocks.actionAuth.mockResolvedValue({ uid: 7, role: 3 })
      service.mockClear()
      expect(
        typeof (await run({
          page: 1,
          limit: 20,
          search: '',
          userId: undefined
        }))
      ).toBe('string')
      expect(service).not.toHaveBeenCalled()
    }
  )
})
