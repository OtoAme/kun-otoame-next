import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const memory = vi.hoisted(() => ({
  values: new Map<string, string>(),
  revisionUnavailable: false,
  writes: vi.fn(),
  locks: vi.fn(),
  purge: vi.fn()
}))

// Keep the real domain cache and getOrSet. Only replace the Redis transport.
vi.mock('ioredis', () => ({
  default: class Redis {
    async get(key: string) {
      if (memory.revisionUnavailable && key.endsWith('shoutbox_revision:v1')) {
        throw new Error('mock revision unavailable')
      }
      return memory.values.get(key) ?? null
    }
    async set(key: string, value: string, ...options: unknown[]) {
      memory.locks(key)
      if (options.includes('NX') && memory.values.has(key)) return null
      memory.values.set(key, value)
      return 'OK'
    }
    async setex(key: string, _ttl: number, value: string) {
      memory.writes(key)
      memory.values.set(key, value)
      return 'OK'
    }
    async incr(key: string) {
      const next = Number(memory.values.get(key) ?? 0) + 1
      memory.values.set(key, String(next))
      return next
    }
    async scan(_cursor: string, _match: string, pattern: string) {
      const prefix = pattern.replace(/\*$/, '')
      return [
        '0',
        [...memory.values.keys()].filter((key) => key.startsWith(prefix))
      ]
    }
    async del(...keys: string[]) {
      return keys.reduce(
        (total, key) => total + Number(memory.values.delete(key)),
        0
      )
    }
    async eval(_script: string, _count: number, key: string, token: string) {
      return memory.values.get(key) === token
        ? Number(memory.values.delete(key))
        : 0
    }
  }
}))
vi.mock('~/app/api/utils/purgeCloudflareCache', () => ({
  purgePublicApiCache: memory.purge
}))

import {
  getShoutboxCached,
  invalidateShoutboxCaches
} from '~/app/api/shoutbox/cache'
import { getPrefixedRedisKey } from '~/lib/redis'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const payload = (content: string) => ({
  content,
  validUntil: new Date(Date.now() + 60_000).toISOString()
})

describe('shoutbox cache with the real Redis cache helper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    memory.values.clear()
    memory.revisionUnavailable = false
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('merges 100 cold reads and reuses the persisted result without another build', async () => {
    const result = payload('shared')
    const build = vi.fn(async () => result)
    const reads = await Promise.all(
      Array.from({ length: 100 }, () =>
        getShoutboxCached('shoutbox:home:v4', build, 60)
      )
    )
    expect(reads).toEqual(Array.from({ length: 100 }, () => result))
    expect(build).toHaveBeenCalledOnce()
    expect(memory.writes).toHaveBeenCalledOnce()
    expect(await getShoutboxCached('shoutbox:home:v4', build, 60)).toEqual(
      result
    )
    expect(build).toHaveBeenCalledOnce()
  })

  it('keeps an old build finishing after invalidation out of all subsequent reads', async () => {
    const started = deferred<void>()
    const release = deferred<ReturnType<typeof payload>>()
    const old = payload('before write')
    const fresh = payload('after write')
    const key = 'shoutbox:list:v4:p1'
    const oldRead = getShoutboxCached(
      key,
      async () => {
        started.resolve()
        return release.promise
      },
      60
    )
    await started.promise
    try {
      await invalidateShoutboxCaches()
      expect(
        memory.values.get(getPrefixedRedisKey('shoutbox_revision:v1'))
      ).toBe('1')
      const build = vi.fn(async () => fresh)
      expect(await getShoutboxCached(key, build, 60)).toEqual(fresh)
      release.resolve(old)
      expect(await oldRead).toEqual(old)
      // The old snapshot may be written after deletion, but the revision stays new.
      expect(memory.values.has(getPrefixedRedisKey(`${key}:r0`))).toBe(true)
      expect(await getShoutboxCached(key, build, 60)).toEqual(fresh)
      expect(build).toHaveBeenCalledOnce()
    } finally {
      release.resolve(old)
      await oldRead
    }
  })

  it('merges 100 revision failures locally and releases the result without Redis locks or writes', async () => {
    memory.revisionUnavailable = true
    const build = vi.fn(async () => payload('fallback'))
    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        getShoutboxCached('shoutbox:home:v4', build, 60)
      )
    )
    expect(results.every((value) => value.content === 'fallback')).toBe(true)
    expect(build).toHaveBeenCalledOnce()
    expect(memory.locks).not.toHaveBeenCalled()
    expect(memory.writes).not.toHaveBeenCalled()
    await getShoutboxCached('shoutbox:home:v4', build, 60)
    expect(build).toHaveBeenCalledTimes(2)
  })
})
