import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getOrSet: vi.fn(),
  getKv: vi.fn(),
  getPrefixedRedisKey: vi.fn((key: string) => key),
  redis: { incr: vi.fn() },
  runRedisCommand: vi.fn((command: () => Promise<unknown>) => command()),
  delKvPattern: vi.fn(),
  purgePublicApiCache: vi.fn()
}))

vi.mock('~/lib/redis', () => ({
  getOrSet: mocks.getOrSet,
  getKv: mocks.getKv,
  getPrefixedRedisKey: mocks.getPrefixedRedisKey,
  redis: mocks.redis,
  runRedisCommand: mocks.runRedisCommand,
  delKvPattern: mocks.delKvPattern
}))
vi.mock('~/app/api/utils/purgeCloudflareCache', () => ({
  purgePublicApiCache: mocks.purgePublicApiCache
}))

import {
  getShoutboxCached,
  getShoutboxCacheKey,
  getShoutboxCacheTtl,
  getShoutboxBannerCacheKey,
  invalidateShoutboxCaches,
  SHOUTBOX_CACHE_REVISION_KEY
} from '~/app/api/shoutbox/cache'

describe('shoutbox cache clock validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getKv.mockResolvedValue(null)
    mocks.runRedisCommand.mockImplementation((command) => command())
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

    expect(mocks.getOrSet.mock.calls[0][0]).toBe('shoutbox:list:v4:p1:r0')
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
    expect(getShoutboxBannerCacheKey()).toBe('shoutbox:banner:v4')
  })

  it('includes the current revision in the Redis data key', async () => {
    mocks.getKv.mockResolvedValueOnce('7')
    mocks.getOrSet.mockResolvedValueOnce({
      validUntil: '2026-09-11T12:01:00.000Z'
    })

    await getShoutboxCached(
      'shoutbox:list:v4:p1',
      async () => ({ validUntil: '2026-09-11T12:01:00.000Z' }),
      60
    )

    expect(mocks.getKv).toHaveBeenCalledWith(SHOUTBOX_CACHE_REVISION_KEY)
    expect(mocks.getOrSet.mock.calls[0][0]).toBe('shoutbox:list:v4:p1:r7')
  })

  it('does not let a new revision read an older data key', async () => {
    mocks.getKv.mockResolvedValueOnce('1').mockResolvedValueOnce('2')
    mocks.getOrSet
      .mockResolvedValueOnce({ validUntil: '2026-09-11T12:01:00.000Z' })
      .mockResolvedValueOnce({ validUntil: '2026-09-11T12:01:00.000Z' })

    const fetcher = async () => ({
      validUntil: '2026-09-11T12:01:00.000Z'
    })
    await getShoutboxCached('shoutbox:list:v4:p1', fetcher, 60)
    await getShoutboxCached('shoutbox:list:v4:p1', fetcher, 60)

    expect(mocks.getOrSet.mock.calls.map(([key]) => key)).toEqual([
      'shoutbox:list:v4:p1:r1',
      'shoutbox:list:v4:p1:r2'
    ])
  })

  it('merges concurrent reads locally when the revision read fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mocks.getKv.mockRejectedValue(new Error('revision unavailable'))
      let release!: () => void
      const pending = new Promise<void>((resolve) => {
        release = resolve
      })
      const fetcher = vi.fn(async () => {
        await pending
        return { validUntil: '2026-09-11T12:01:00.000Z' }
      })

      const reads = Array.from({ length: 100 }, () =>
        getShoutboxCached('shoutbox:list:v4:p1', fetcher, 60)
      )
      expect(mocks.getOrSet).not.toHaveBeenCalled()
      release()
      await Promise.all(reads)
      expect(fetcher).toHaveBeenCalledOnce()
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('deletes and purges even when revision increment fails', async () => {
    const events: string[] = []
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mocks.redis.incr.mockImplementationOnce(async () => {
        events.push('increment')
        throw new Error('revision unavailable')
      })
      mocks.delKvPattern.mockImplementationOnce(async () => {
        events.push('delete')
      })
      mocks.purgePublicApiCache.mockImplementationOnce(async () => {
        events.push('purge')
      })

      await invalidateShoutboxCaches()

      expect(events).toEqual(['increment', 'delete', 'purge'])
      expect(mocks.delKvPattern).toHaveBeenCalledWith('shoutbox:*')
      expect(mocks.purgePublicApiCache).toHaveBeenCalledWith([
        '/api/shoutbox',
        '/api/shoutbox/banner'
      ])
    } finally {
      errorSpy.mockRestore()
    }
  })
})
