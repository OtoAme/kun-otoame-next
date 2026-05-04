import Redis, { type RedisOptions } from 'ioredis'
import { randomUUID } from 'crypto'

const KUN_PATCH_REDIS_PREFIX = 'kun:touchgal'
const REDIS_MULTI_KEY_BATCH_SIZE = 500
const REDIS_CONNECT_TIMEOUT_MS = 2000
const REDIS_COMMAND_TIMEOUT_MS = 2000
const REDIS_RETRY_BASE_DELAY_MS = 100
const REDIS_RETRY_MAX_DELAY_MS = 2000

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

export const getOrSet = async <T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number
): Promise<T> => {
  if (pendingPromises.has(key)) {
    return pendingPromises.get(key) as Promise<T>
  }

  const promise = (async () => {
    try {
      let cached: string | null = null
      try {
        cached = await getKv(key)
      } catch (error) {
        console.error(`[Redis] Get error for key ${key}:`, error)
      }

      if (cached) {
        return JSON.parse(cached)
      }

      const data = await fetcher()

      try {
        await setKv(key, JSON.stringify(data), ttl)
      } catch (error) {
        console.error(`[Redis] Set error for key ${key}:`, error)
      }

      return data
    } finally {
      pendingPromises.delete(key)
    }
  })()

  pendingPromises.set(key, promise)
  return promise
}
