import Redis, { type RedisOptions } from 'ioredis'
import { randomUUID } from 'crypto'

const KUN_PATCH_REDIS_PREFIX = 'kun:touchgal'
const REDIS_MULTI_KEY_BATCH_SIZE = 500
const REDIS_CONNECT_TIMEOUT_MS = 2000
const REDIS_COMMAND_TIMEOUT_MS = 2000
const REDIS_RETRY_BASE_DELAY_MS = 100
const REDIS_RETRY_MAX_DELAY_MS = 2000
const CACHE_ENVELOPE_VERSION = 1
const CACHE_STALE_TTL_MULTIPLIER = 6
const CACHE_MIN_STALE_TTL_SECONDS = 60
const CACHE_REFRESH_LOCK_TTL_SECONDS = 10
const CACHE_WAIT_FOR_REFRESH_TIMEOUT_MS = 800
const CACHE_WAIT_FOR_REFRESH_INTERVAL_MS = 50
const CACHE_TTL_JITTER_RATIO = 0.1

const redisOptions: RedisOptions = {
  port: parseInt(process.env.REDIS_PORT!),
  host: process.env.REDIS_HOST,
  password: process.env.REDIS_PASSWORD,
  connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
  commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
  retryStrategy: (times) =>
    Math.min(times * REDIS_RETRY_BASE_DELAY_MS, REDIS_RETRY_MAX_DELAY_MS)
}

export const redis = new Redis(redisOptions)

export const runRedisCommand = async <T>(command: () => Promise<T>) => command()

export const setKv = async (key: string, value: string, time?: number) => {
  const keyString = `${KUN_PATCH_REDIS_PREFIX}:${key}`
  if (time) {
    await runRedisCommand(() => redis.setex(keyString, time, value))
  } else {
    await runRedisCommand(() => redis.set(keyString, value))
  }
}

export const getKv = async (key: string) => {
  const keyString = `${KUN_PATCH_REDIS_PREFIX}:${key}`
  const value = await runRedisCommand(() => redis.get(keyString))
  return value
}

export const getKvs = async (keys: string[]) => {
  if (keys.length === 0) {
    return []
  }

  const keyStrings = keys.map((key) => `${KUN_PATCH_REDIS_PREFIX}:${key}`)
  return runRedisCommand(() => redis.mget(...keyStrings))
}

export const delKv = async (key: string) => {
  const keyString = `${KUN_PATCH_REDIS_PREFIX}:${key}`
  await runRedisCommand(() => redis.del(keyString))
}

export const delKvs = async (keys: string[]) => {
  if (keys.length === 0) {
    return
  }

  const keyStrings = keys.map((key) => `${KUN_PATCH_REDIS_PREFIX}:${key}`)
  for (let i = 0; i < keyStrings.length; i += REDIS_MULTI_KEY_BATCH_SIZE) {
    await runRedisCommand(() =>
      redis.del(...keyStrings.slice(i, i + REDIS_MULTI_KEY_BATCH_SIZE))
    )
  }
}

export const acquireKvLock = async (key: string, ttlSeconds = 10) => {
  const keyString = `${KUN_PATCH_REDIS_PREFIX}:${key}`
  const token = randomUUID()
  const result = await runRedisCommand(() =>
    redis.set(keyString, token, 'EX', ttlSeconds, 'NX')
  )

  if (result !== 'OK') {
    return null
  }

  return token
}

export const releaseKvLock = async (key: string, token: string) => {
  const keyString = `${KUN_PATCH_REDIS_PREFIX}:${key}`
  await runRedisCommand(() =>
    redis.eval(
      `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        end
        return 0
      `,
      1,
      keyString,
      token
    )
  )
}

export const delKvPattern = async (pattern: string) => {
  const keyPattern = `${KUN_PATCH_REDIS_PREFIX}:${pattern}`
  let cursor = '0'

  do {
    const [nextCursor, keys] = await runRedisCommand(() =>
      redis.scan(cursor, 'MATCH', keyPattern, 'COUNT', 100)
    )
    cursor = nextCursor

    if (keys.length) {
      await runRedisCommand(() => redis.del(...keys))
    }
  } while (cursor !== '0')
}

const pendingPromises = new Map<string, Promise<any>>()

type CacheEnvelope<T> = {
  __kunCacheVersion: typeof CACHE_ENVELOPE_VERSION
  expiresAt: number
  staleUntil: number
  value: T
}

type CacheReadResult<T> = {
  value: T
  isFresh: boolean
  isStale: boolean
}

type GetOrSetOptions = {
  staleTtl?: number
  lockTtl?: number
  waitForRefreshMs?: number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const isCacheEnvelope = <T>(value: unknown): value is CacheEnvelope<T> => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const maybeEnvelope = value as Partial<CacheEnvelope<T>>
  return (
    maybeEnvelope.__kunCacheVersion === CACHE_ENVELOPE_VERSION &&
    typeof maybeEnvelope.expiresAt === 'number' &&
    typeof maybeEnvelope.staleUntil === 'number' &&
    'value' in maybeEnvelope
  )
}

const parseCachedValue = <T>(cached: string): CacheReadResult<T> | null => {
  const parsed = JSON.parse(cached) as unknown

  if (!isCacheEnvelope<T>(parsed)) {
    return {
      value: parsed as T,
      isFresh: true,
      isStale: false
    }
  }

  const now = Date.now()
  if (now < parsed.expiresAt) {
    return {
      value: parsed.value,
      isFresh: true,
      isStale: false
    }
  }

  if (now < parsed.staleUntil) {
    return {
      value: parsed.value,
      isFresh: false,
      isStale: true
    }
  }

  return null
}

const getStaleTtl = (ttl: number, staleTtl?: number) =>
  staleTtl ??
  Math.max(ttl * CACHE_STALE_TTL_MULTIPLIER, CACHE_MIN_STALE_TTL_SECONDS)

const getRedisTtl = (ttl: number, staleTtl: number) => {
  const baseTtl = ttl + staleTtl
  const jitter = Math.floor(baseTtl * CACHE_TTL_JITTER_RATIO * Math.random())
  return baseTtl + jitter
}

const setCachedValue = async <T>(
  key: string,
  value: T,
  ttl: number,
  staleTtl: number
) => {
  const now = Date.now()
  const envelope: CacheEnvelope<T> = {
    __kunCacheVersion: CACHE_ENVELOPE_VERSION,
    expiresAt: now + ttl * 1000,
    staleUntil: now + (ttl + staleTtl) * 1000,
    value
  }

  await setKv(key, JSON.stringify(envelope), getRedisTtl(ttl, staleTtl))
}

const getCachedValue = async <T>(key: string) => {
  const cached = await getKv(key)
  return cached ? parseCachedValue<T>(cached) : null
}

const refreshCache = async <T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number,
  staleTtl: number
) => {
  const data = await fetcher()
  await setCachedValue(key, data, ttl, staleTtl)
  return data
}

const getValueAfterPeerRefresh = async <T>(key: string, timeoutMs: number) => {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    await sleep(CACHE_WAIT_FOR_REFRESH_INTERVAL_MS)

    try {
      const cached = await getCachedValue<T>(key)
      if (cached?.isFresh) {
        return cached.value
      }
    } catch (error) {
      console.error(`[Redis] Peer refresh read error for key ${key}:`, error)
      return null
    }
  }

  return null
}

export const getOrSet = async <T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number,
  options: GetOrSetOptions = {}
): Promise<T> => {
  if (pendingPromises.has(key)) {
    return pendingPromises.get(key) as Promise<T>
  }

  const promise = (async () => {
    const staleTtl = getStaleTtl(ttl, options.staleTtl)
    const lockTtl = options.lockTtl ?? CACHE_REFRESH_LOCK_TTL_SECONDS
    const waitForRefreshMs =
      options.waitForRefreshMs ?? CACHE_WAIT_FOR_REFRESH_TIMEOUT_MS

    try {
      let cached: CacheReadResult<T> | null = null
      try {
        cached = await getCachedValue<T>(key)
      } catch (error) {
        console.error(`[Redis] Get error for key ${key}:`, error)
      }

      if (cached?.isFresh) {
        return cached.value
      }

      const lockKey = `lock:cache:${key}`
      let lockToken: string | null = null

      try {
        lockToken = await acquireKvLock(lockKey, lockTtl)
      } catch (error) {
        console.error(`[Redis] Lock error for key ${key}:`, error)
      }

      if (cached?.isStale) {
        if (lockToken) {
          const refreshLockToken = lockToken
          refreshCache(key, fetcher, ttl, staleTtl)
            .catch((error) => {
              console.error(
                `[Redis] Background refresh error for key ${key}:`,
                error
              )
            })
            .finally(() => {
              releaseKvLock(lockKey, refreshLockToken).catch((error) => {
                console.error(
                  `[Redis] Lock release error for key ${key}:`,
                  error
                )
              })
            })
        }

        return cached.value
      }

      if (lockToken) {
        try {
          const data = await fetcher()
          try {
            await setCachedValue(key, data, ttl, staleTtl)
          } catch (error) {
            console.error(`[Redis] Set error for key ${key}:`, error)
          }
          return data
        } catch (error) {
          console.error(`[Redis] Fetch error for key ${key}:`, error)
          throw error
        } finally {
          try {
            await releaseKvLock(lockKey, lockToken)
          } catch (error) {
            console.error(`[Redis] Lock release error for key ${key}:`, error)
          }
        }
      }

      const peerRefreshedValue = await getValueAfterPeerRefresh<T>(
        key,
        waitForRefreshMs
      )
      if (peerRefreshedValue !== null) {
        return peerRefreshedValue
      }

      const data = await fetcher()
      try {
        await setCachedValue(key, data, ttl, staleTtl)
      } catch (error) {
        console.error(`[Redis] Fallback set error for key ${key}:`, error)
      }
      return data
    } finally {
      pendingPromises.delete(key)
    }
  })()

  pendingPromises.set(key, promise)
  return promise
}
