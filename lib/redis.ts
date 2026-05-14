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
const CACHE_REFRESH_LOCK_TTL_SECONDS = 30
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

export const getPrefixedRedisKey = (key: string) =>
  `${KUN_PATCH_REDIS_PREFIX}:${key}`

export const setKv = async (key: string, value: string, time?: number) => {
  const keyString = getPrefixedRedisKey(key)
  if (time) {
    await runRedisCommand(() => redis.setex(keyString, time, value))
  } else {
    await runRedisCommand(() => redis.set(keyString, value))
  }
}

export const getKv = async (key: string) => {
  const keyString = getPrefixedRedisKey(key)
  const value = await runRedisCommand(() => redis.get(keyString))
  return value
}

export const getKvs = async (keys: string[]) => {
  if (keys.length === 0) {
    return []
  }

  const keyStrings = keys.map(getPrefixedRedisKey)
  return runRedisCommand(() => redis.mget(...keyStrings))
}

export const delKv = async (key: string) => {
  const keyString = getPrefixedRedisKey(key)
  await runRedisCommand(() => redis.del(keyString))
}

export const delKvs = async (keys: string[]) => {
  if (keys.length === 0) {
    return
  }

  const keyStrings = keys.map(getPrefixedRedisKey)
  for (let i = 0; i < keyStrings.length; i += REDIS_MULTI_KEY_BATCH_SIZE) {
    await deleteRedisKeys(keyStrings.slice(i, i + REDIS_MULTI_KEY_BATCH_SIZE))
  }
}

export const acquireKvLock = async (key: string, ttlSeconds = 10) => {
  const keyString = getPrefixedRedisKey(key)
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
  const keyString = getPrefixedRedisKey(key)
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

export type UploadMetadata = {
  userId: number
  hash: string
  path: string
  localDir: string
  sizeBytes: number
  size: string
  filename: string
  createdAt: string
}

type UploadConsumeResult =
  | { ok: true; data: UploadMetadata; token: string }
  | { ok: false; code: string }

type UploadConsumeScriptResult =
  | { ok: true; data: UploadMetadata }
  | { ok: false; code: string }

type UploadFinalizeResult = { ok: true } | { ok: false; code: string }

const UPLOAD_CONSUME_LOCK_TTL_SECONDS = 15 * 60

const getUploadMetadataKey = (uploadId: string) => `upload:${uploadId}`
const getUploadConsumeLockKey = (uploadId: string) =>
  `upload:consume:${uploadId}`

const parseRedisJson = <T>(value: unknown): T => {
  if (typeof value !== 'string') {
    throw new Error('Invalid Redis JSON response')
  }
  return JSON.parse(value) as T
}

export const setUploadMetadata = async (
  uploadId: string,
  metadata: UploadMetadata,
  ttlSeconds: number
) => {
  await setKv(
    getUploadMetadataKey(uploadId),
    JSON.stringify(metadata),
    ttlSeconds
  )
}

export const consumeUpload = async (
  uploadId: string,
  userId: number,
  lockTtlSeconds = UPLOAD_CONSUME_LOCK_TTL_SECONDS
): Promise<UploadConsumeResult> => {
  const metadataKey = getPrefixedRedisKey(getUploadMetadataKey(uploadId))
  const lockKey = getPrefixedRedisKey(getUploadConsumeLockKey(uploadId))
  const token = randomUUID()

  const result = await runRedisCommand(() =>
    redis.eval(
      `
        local meta = redis.call("GET", KEYS[1])
        if not meta then
          return cjson.encode({ ok = false, code = "UPLOAD_NOT_FOUND" })
        end

        local parsed = cjson.decode(meta)
        if tostring(parsed.userId) ~= ARGV[1] then
          return cjson.encode({ ok = false, code = "OWNER_MISMATCH" })
        end

        local locked = redis.call("SET", KEYS[2], ARGV[2], "NX", "EX", ARGV[3])
        if not locked then
          return cjson.encode({ ok = false, code = "ALREADY_CONSUMING" })
        end

        return cjson.encode({ ok = true, data = parsed })
      `,
      2,
      metadataKey,
      lockKey,
      String(userId),
      token,
      String(lockTtlSeconds)
    )
  )

  const parsed = parseRedisJson<UploadConsumeScriptResult>(result)
  if (!parsed.ok) {
    return parsed
  }

  return { ...parsed, token }
}

export const finalizeUpload = async (
  uploadId: string,
  token: string
): Promise<UploadFinalizeResult> => {
  const metadataKey = getPrefixedRedisKey(getUploadMetadataKey(uploadId))
  const lockKey = getPrefixedRedisKey(getUploadConsumeLockKey(uploadId))

  const result = await runRedisCommand(() =>
    redis.eval(
      `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          redis.call("DEL", KEYS[1], KEYS[2])
          return cjson.encode({ ok = true })
        end

        return cjson.encode({ ok = false, code = "TOKEN_MISMATCH" })
      `,
      2,
      lockKey,
      metadataKey,
      token
    )
  )

  return parseRedisJson<UploadFinalizeResult>(result)
}

export const releaseUploadConsumeLock = async (
  uploadId: string,
  token: string
) => {
  await releaseKvLock(getUploadConsumeLockKey(uploadId), token)
}

export const delKvPattern = async (pattern: string) => {
  const keyPattern = getPrefixedRedisKey(pattern)
  let cursor = '0'

  do {
    const [nextCursor, keys] = await runRedisCommand(() =>
      redis.scan(cursor, 'MATCH', keyPattern, 'COUNT', 100)
    )
    cursor = nextCursor

    if (keys.length) {
      await deleteRedisKeys(keys)
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

const deleteRedisKeys = async (keys: string[]) => {
  if ('unlink' in redis && typeof redis.unlink === 'function') {
    await runRedisCommand(() => redis.unlink(...keys))
    return
  }

  await runRedisCommand(() => redis.del(...keys))
}

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
        return { value: cached.value }
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

      // Cold misses must not fan out to the database. Wait for the lock holder
      // to publish a fresh value, then retry the distributed lock if needed.
      while (!lockToken) {
        const peerRefreshedValue = await getValueAfterPeerRefresh<T>(
          key,
          waitForRefreshMs
        )
        if (peerRefreshedValue) {
          return peerRefreshedValue.value
        }

        try {
          lockToken = await acquireKvLock(lockKey, lockTtl)
        } catch (error) {
          console.error(`[Redis] Lock retry error for key ${key}:`, error)
          break
        }
      }

      if (lockToken) {
        try {
          const data = await fetcher()
          try {
            await setCachedValue(key, data, ttl, staleTtl)
          } catch (error) {
            console.error(
              `[Redis] Set after retry error for key ${key}:`,
              error
            )
          }
          return data
        } finally {
          try {
            await releaseKvLock(lockKey, lockToken)
          } catch (error) {
            console.error(`[Redis] Lock release error for key ${key}:`, error)
          }
        }
      }

      console.error(
        `[Redis] Bypassing cache lock for key ${key} because Redis lock retry failed`
      )
      return fetcher()
    } finally {
      pendingPromises.delete(key)
    }
  })()

  pendingPromises.set(key, promise)
  return promise
}
