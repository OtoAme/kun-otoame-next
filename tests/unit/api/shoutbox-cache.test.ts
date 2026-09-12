import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getOrSet: vi.fn(),
  delKvPattern: vi.fn(),
  purgePublicApiCache: vi.fn()
}))

vi.mock('~/lib/redis', () => ({
  getOrSet: mocks.getOrSet,
  delKvPattern: mocks.delKvPattern
}))
vi.mock('~/app/api/utils/purgeCloudflareCache', () => ({
  purgePublicApiCache: mocks.purgePublicApiCache
}))

import {
  getShoutboxCached,
  getShoutboxCacheKey,
  getShoutboxCacheTtl,
  getShoutboxBannerCacheKey
} from '~/app/api/shoutbox/cache'

describe('shoutbox cache clock validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes the injected clock into cache hit validation', async () => {
    const start = new Date('2026-09-11T12:00:00.000Z')
    let current = start
    mocks.getOrSet.mockResolvedValueOnce({
      validUntil: new Date(start.getTime() + 60_000).toISOString()
    })

    await getShoutboxCached(
      'shoutbox:list:v4:p1',
      async () => ({ validUntil: start.toISOString() }),
      60,
      () => current
    )

    const options = mocks.getOrSet.mock.calls[0][3] as {
      staleTtl: number
      getCacheTtl: (value: { validUntil: string }, now: Date) => number
      isCachedValueValid: (value: { validUntil: string }) => boolean
    }
    expect(options.staleTtl).toBe(0)
    expect(
      options.getCacheTtl(
        { validUntil: new Date(start.getTime() + 2_999).toISOString() },
        start
      )
    ).toBe(2)
    expect(
      options.getCacheTtl(
        { validUntil: new Date(start.getTime()).toISOString() },
        start
      )
    ).toBe(0)
    expect(
      getShoutboxCacheTtl(new Date(start.getTime() - 1).toISOString(), start)
    ).toBe(-1)
    expect(
      options.isCachedValueValid({
        validUntil: new Date(start.getTime() + 60_000).toISOString()
      })
    ).toBe(true)
    current = new Date(start.getTime() + 60_000)
    expect(
      options.isCachedValueValid({
        validUntil: new Date(start.getTime() + 60_000).toISOString()
      })
    ).toBe(false)
  })

  it('keeps the fifteen-row home payload separate from list page one', () => {
    expect(getShoutboxCacheKey(null, 1, 'home')).toBe('shoutbox:home:v4')
    expect(getShoutboxCacheKey(null, 1)).toBe('shoutbox:list:v4:p1')
    expect(getShoutboxCacheKey('Abc12345', 1)).toBe(
      'shoutbox:patch:v4:Abc12345:p1'
    )
    expect(getShoutboxBannerCacheKey()).toBe('shoutbox:banner:v3')
  })
})
