import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  findUser: vi.fn(),
  cookies: vi.fn()
}))
vi.mock('~/app/api/utils/jwt', () => ({
  verifyKunTokenResult: mocks.verify,
  SessionUnavailableError: class extends Error {}
}))
vi.mock('~/prisma', () => ({
  prisma: { user: { findUnique: mocks.findUser } }
}))
vi.mock('next/headers', () => ({ cookies: mocks.cookies }))

import {
  getRequestIdentity,
  getSessionContext
} from '~/app/api/utils/sessionIdentity'
import { getPatchVisibilityWhere } from '~/app/api/utils/getPatchVisibilityWhere'
import { getNSFWHeader as getPageNsfw } from '~/utils/actions/getNSFWHeader'
import { getBlockedTagIds as getPageTags } from '~/utils/actions/getBlockedTagIds'

const request = (token = '', mode = 'all') =>
  new Request('https://example.test', {
    headers: {
      cookie: `kun-galgame-patch-moe-token=${token}; kun-patch-setting-store|state|data|kunNsfwEnable=${mode}; kun-patch-setting-store|state|data|kunBlockedTagIds=%5B7%5D`
    }
  })
const payload = {
  uid: 7,
  jti: 'verified-session',
  name: 'synthetic',
  role: 1,
  iss: 'test',
  aud: 'test'
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.verify.mockResolvedValue({ status: 'guest' })
  mocks.cookies.mockResolvedValue({
    get: (name: string) => ({
      value: name.includes('Nsfw')
        ? 'all'
        : name.includes('BlockedTag')
          ? '[7]'
          : 'expired'
    })
  })
})

describe('verified browsing identity', () => {
  it.each(['', 'expired', 'revoked', 'malformed'])(
    'ignores residual preferences for guest %s',
    async (token) => {
      expect(await getPatchVisibilityWhere(request(token) as never)).toEqual({
        content_limit: 'sfw'
      })
    }
  )

  it('requires valid page identity before applying residual preferences', async () => {
    expect(await getPageNsfw()).toEqual({ content_limit: 'sfw' })
    expect(await getPageTags()).toEqual([])
  })

  it('reuses one verification per request while keeping concurrent visitors separate', async () => {
    mocks.verify.mockImplementation(async (token: string) =>
      token === 'valid'
        ? { status: 'authenticated', payload }
        : { status: 'guest' }
    )
    const valid = request('valid')
    const invalid = request('expired')
    const [first, second, guest] = await Promise.all([
      getRequestIdentity(valid),
      getPatchVisibilityWhere(valid as never),
      getPatchVisibilityWhere(invalid as never)
    ])
    expect(first).toEqual({ status: 'authenticated', payload })
    expect(second).not.toHaveProperty('content_limit')
    expect(second).toHaveProperty('NOT')
    expect(guest).toEqual({ content_limit: 'sfw' })
    expect(mocks.verify).toHaveBeenCalledTimes(2)
    await getRequestIdentity(request('valid'))
    expect(mocks.verify).toHaveBeenCalledTimes(3)
  })

  it.each(['invalid', 'undefined', 'SFw'])(
    'safely defaults invalid mode %s for a valid account',
    async (mode) => {
      mocks.verify.mockResolvedValue({ status: 'authenticated', payload })
      expect(
        await getPatchVisibilityWhere(request('valid', mode) as never)
      ).toHaveProperty('content_limit', 'sfw')
    }
  )

  it('fails closed on infrastructure errors without returning guest success', async () => {
    mocks.verify.mockResolvedValue({ status: 'unavailable' })
    await expect(
      getPatchVisibilityWhere(request('valid') as never)
    ).rejects.toThrow()
    await expect(getPageNsfw()).rejects.toThrow()
    await expect(getPageTags()).rejects.toThrow()
  })

  it('binds opaque context to actual authenticated session identity', () => {
    expect(getSessionContext(payload)).toBe(getSessionContext(payload))
    expect(getSessionContext(payload)).not.toContain(payload.jti)
    expect(getSessionContext({ ...payload, jti: 'other' })).not.toBe(
      getSessionContext(payload)
    )
    expect(() => getSessionContext({ ...payload, jti: '' })).toThrow()
  })
})
