import Redis from 'ioredis'
import { randomUUID } from 'crypto'

const KUN_PATCH_REDIS_PREFIX = 'kun:touchgal'

export const redis = new Redis({
  port: parseInt(process.env.REDIS_PORT!),
  host: process.env.REDIS_HOST,
  password: process.env.REDIS_PASSWORD
})

export const setKv = async (key: string, value: string, time?: number) => {
  const keyString = `${KUN_PATCH_REDIS_PREFIX}:${key}`
  if (time) {
    await redis.setex(keyString, time, value)
  } else {
    await redis.set(keyString, value)
  }
}

export const getKv = async (key: string) => {
  const keyString = `${KUN_PATCH_REDIS_PREFIX}:${key}`
  const value = await redis.get(keyString)
  return value
}

export const delKv = async (key: string) => {
  const keyString = `${KUN_PATCH_REDIS_PREFIX}:${key}`
  await redis.del(keyString)
}

export const delKvPattern = async (pattern: string) => {
  const keyPattern = `${KUN_PATCH_REDIS_PREFIX}:${pattern}`
  let cursor = '0'

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      'MATCH',
      keyPattern,
      'COUNT',
      100
    )
    cursor = nextCursor

    if (keys.length) {
      await redis.del(...keys)
    }
  } while (cursor !== '0')
}

export const acquireKvLock = async (key: string, ttlSeconds = 10) => {
  const keyString = `${KUN_PATCH_REDIS_PREFIX}:${key}`
  const token = randomUUID()
  const result = await redis.set(keyString, token, 'EX', ttlSeconds, 'NX')

  if (result !== 'OK') {
    return null
  }

  return token
}

export const releaseKvLock = async (key: string, token: string) => {
  const keyString = `${KUN_PATCH_REDIS_PREFIX}:${key}`
  await redis.eval(
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
