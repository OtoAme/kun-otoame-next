import Redis from 'ioredis'

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
