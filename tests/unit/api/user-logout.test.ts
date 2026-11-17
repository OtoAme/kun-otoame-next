import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ identity: vi.fn(), revoke: vi.fn() }))
vi.mock('~/app/api/utils/jwt', () => ({ deleteKunSession: mocks.revoke }))
vi.mock('~/app/api/utils/sessionIdentity', () => ({
  getRequestIdentity: mocks.identity
}))
import { POST } from '~/app/api/user/status/logout/route'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.revoke.mockResolvedValue(undefined)
})

describe('logout cookie and revocation truth', () => {
  it.each(['guest', 'authenticated', 'unavailable'])(
    'clears root cookies for %s identity',
    async (status) => {
      mocks.identity.mockResolvedValue({
        status,
        payload: { uid: 7, jti: 'session' }
      })
      const response = await POST(
        new Request('https://example.test/api/user/status/logout') as never
      )
      expect(response.status).toBe(status === 'unavailable' ? 503 : 200)
      const body = await response.json()
      expect(body.revoked).toBe(status !== 'unavailable')
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      for (const name of [
        'kun-galgame-patch-moe-token',
        'kun-patch-setting-store|state|data|kunNsfwEnable',
        'kun-patch-setting-store|state|data|kunBlockedTagIds'
      ]) {
        expect(response.cookies.get(name)).toMatchObject({
          value: '',
          path: '/',
          maxAge: 0
        })
      }
      expect(mocks.revoke).toHaveBeenCalledTimes(
        status === 'authenticated' ? 1 : 0
      )
    }
  )

  it('reports failed revocation without claiming success', async () => {
    mocks.identity.mockResolvedValue({
      status: 'authenticated',
      payload: { uid: 7, jti: 'session' }
    })
    mocks.revoke.mockRejectedValueOnce(new Error('offline'))
    const response = await POST(
      new Request('https://example.test/api/user/status/logout') as never
    )
    expect(response.status).toBe(503)
    expect((await response.json()).revoked).toBe(false)
    expect(response.cookies.get('kun-galgame-patch-moe-token')?.maxAge).toBe(0)
  })
})
