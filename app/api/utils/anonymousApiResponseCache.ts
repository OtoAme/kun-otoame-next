import { getKv, setKv, delKvPattern } from '~/lib/redis'
import {
  ANONYMOUS_API_CACHE_CONTROL,
  PERSONALIZED_API_CACHE_CONTROL,
  isPersonalizedApiRequest
} from './cacheHeaders'

const ANONYMOUS_API_RESPONSE_CACHE_PREFIX = 'anonymous_api'
const ANONYMOUS_API_RESPONSE_CACHE_TTL_SECONDS = 30
const ANONYMOUS_API_MEMORY_CACHE_TTL_MS =
  ANONYMOUS_API_RESPONSE_CACHE_TTL_SECONDS * 1000
const ANONYMOUS_API_MEMORY_CACHE_MAX_ENTRIES = 512

type JsonProducer<T> = () => Promise<T>
type AnonymousApiResponseCacheOptions<T> = {
  shouldCacheValue?: (value: T) => boolean
}

type MemoryCacheEntry = {
  body: string
  expiresAt: number
}

const memoryCache = new Map<string, MemoryCacheEntry>()

type AnonymousApiCacheStatus = 'private' | 'memory' | 'pending' | 'redis' | 'miss'

type AnonymousApiCacheResult = {
  body: string
  status: Extract<AnonymousApiCacheStatus, 'redis' | 'miss'>
}

const pendingResponses = new Map<string, Promise<AnonymousApiCacheResult>>()

const getMemoryCache = (key: string) => {
  const cached = memoryCache.get(key)
  if (!cached) {
    return null
  }

  if (Date.now() >= cached.expiresAt) {
    memoryCache.delete(key)
    return null
  }

  return cached.body
}

const setMemoryCache = (key: string, body: string) => {
  if (memoryCache.size >= ANONYMOUS_API_MEMORY_CACHE_MAX_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value
    if (oldestKey) {
      memoryCache.delete(oldestKey)
    }
  }

  memoryCache.set(key, {
    body,
    expiresAt: Date.now() + ANONYMOUS_API_MEMORY_CACHE_TTL_MS
  })
}

const getSortedSearchParams = (url: string) => {
  const params = new URL(url).searchParams
  const sortedParams = new URLSearchParams()

  for (const [key, value] of [...params.entries()].sort(
    ([keyA, valueA], [keyB, valueB]) => {
      const keyCompare = keyA.localeCompare(keyB)
      return keyCompare === 0 ? valueA.localeCompare(valueB) : keyCompare
    }
  )) {
    sortedParams.append(key, value)
  }

  return sortedParams.toString()
}

const getAnonymousApiResponseCacheKey = (
  namespace: string,
  req: Pick<Request, 'url'>
) =>
  `${ANONYMOUS_API_RESPONSE_CACHE_PREFIX}:${namespace}:${getSortedSearchParams(
    req.url
  )}`

const getAnonymousApiMemoryCacheKey = (
  namespace: string,
  req: Pick<Request, 'url'>
) => getAnonymousApiResponseCacheKey(namespace, req)

const jsonResponse = (
  body: string,
  cacheControl: string,
  status: AnonymousApiCacheStatus
) =>
  new Response(body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cacheControl,
      'X-Kun-Cache': status
    }
  })

export const getCachedAnonymousJsonResponse = async <T>(
  req: Pick<Request, 'url' | 'headers'>,
  namespace: string,
  producer: JsonProducer<T>,
  options: AnonymousApiResponseCacheOptions<T> = {}
) => {
  const shouldCacheValue = options.shouldCacheValue ?? (() => true)

  if (isPersonalizedApiRequest(req)) {
    return jsonResponse(
      JSON.stringify(await producer()),
      PERSONALIZED_API_CACHE_CONTROL,
      'private'
    )
  }

  const memoryCacheKey = getAnonymousApiMemoryCacheKey(namespace, req)
  const memoryCached = getMemoryCache(memoryCacheKey)
  if (memoryCached !== null) {
    return jsonResponse(memoryCached, ANONYMOUS_API_CACHE_CONTROL, 'memory')
  }

  const pendingResponse = pendingResponses.get(memoryCacheKey)
  if (pendingResponse) {
    const { body } = await pendingResponse
    return jsonResponse(
      body,
      ANONYMOUS_API_CACHE_CONTROL,
      'pending'
    )
  }

  const cacheKey = getAnonymousApiResponseCacheKey(namespace, req)

  const responsePromise = (async () => {
    let cached: string | null = null
    try {
      cached = await getKv(cacheKey)
    } catch (error) {
      console.error(
        `[Redis] Anonymous API cache get error for ${cacheKey}:`,
        error
      )
    }

    if (cached !== null) {
      setMemoryCache(memoryCacheKey, cached)
      return {
        body: cached,
        status: 'redis' as const
      }
    }

    const produced = await producer()
    const serialized = JSON.stringify(produced)

    if (shouldCacheValue(produced)) {
      setMemoryCache(memoryCacheKey, serialized)

      try {
        await setKv(
          cacheKey,
          serialized,
          ANONYMOUS_API_RESPONSE_CACHE_TTL_SECONDS
        )
      } catch (error) {
        console.error(
          `[Redis] Anonymous API cache set error for ${cacheKey}:`,
          error
        )
      }
    }

    return {
      body: serialized,
      status: 'miss' as const
    }
  })()

  pendingResponses.set(memoryCacheKey, responsePromise)
  try {
    const { body, status } = await responsePromise
    return jsonResponse(body, ANONYMOUS_API_CACHE_CONTROL, status)
  } finally {
    pendingResponses.delete(memoryCacheKey)
  }
}

export const invalidateAnonymousApiResponseCaches = async () => {
  memoryCache.clear()
  pendingResponses.clear()
  await delKvPattern(`${ANONYMOUS_API_RESPONSE_CACHE_PREFIX}:*`)
}
