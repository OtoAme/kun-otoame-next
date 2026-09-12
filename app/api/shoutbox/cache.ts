import {
  SHOUTBOX_BANNER_CACHE_DURATION,
  SHOUTBOX_LIST_CACHE_DURATION,
  SHOUTBOX_PATCH_CACHE_DURATION
} from '~/config/cache'
import {
  delKvPattern,
  getKv,
  getOrSet,
  getPrefixedRedisKey,
  redis,
  runRedisCommand
} from '~/lib/redis'
import { purgePublicApiCache } from '~/app/api/utils/purgeCloudflareCache'

export {
  SHOUTBOX_BANNER_CACHE_DURATION,
  SHOUTBOX_LIST_CACHE_DURATION,
  SHOUTBOX_PATCH_CACHE_DURATION
}

export const getShoutboxCacheKey = (
  patch: string | null,
  page: number,
  view: 'list' | 'home' = 'list'
) => {
  if (view === 'home') return 'shoutbox:home:v4'
  return patch
    ? `shoutbox:patch:v4:${patch}:p${page}`
    : `shoutbox:list:v4:p${page}`
}

export const getShoutboxBannerCacheKey = () => 'shoutbox:banner:v4'

type ValidShoutboxCacheValue = {
  validUntil: string
  visibilityUntil?: string | null
}

export const SHOUTBOX_CACHE_REVISION_KEY = 'shoutbox_revision:v1'

const DEFAULT_SHOUTBOX_CACHE_REVISION = '0'
const SHOUTBOX_CACHE_REVISION_PATTERN = /^\d+$/

/**
 * A revision is kept outside the shoutbox keyspace. Reads that begin after a
 * committed write therefore cannot reuse a value written under an older
 * revision, even if deletion is delayed.
 */
export const getShoutboxCacheRevision = async () => {
  const revision = await getKv(SHOUTBOX_CACHE_REVISION_KEY)
  if (revision == null || revision === '')
    return DEFAULT_SHOUTBOX_CACHE_REVISION
  if (!SHOUTBOX_CACHE_REVISION_PATTERN.test(revision)) {
    throw new Error('Invalid shoutbox cache revision')
  }
  return revision
}

export const incrementShoutboxCacheRevision = async () =>
  String(
    await runRedisCommand(() =>
      redis.incr(getPrefixedRedisKey(SHOUTBOX_CACHE_REVISION_KEY))
    )
  )

const localReadPromises = new Map<string, Promise<unknown>>()

const getLocallyMerged = <T>(key: string, fetcher: () => Promise<T>) => {
  const inFlight = localReadPromises.get(key)
  if (inFlight) return inFlight as Promise<T>

  const promise = Promise.resolve().then(fetcher)
  localReadPromises.set(key, promise)
  promise.then(
    () => {
      if (localReadPromises.get(key) === promise) localReadPromises.delete(key)
    },
    () => {
      if (localReadPromises.get(key) === promise) localReadPromises.delete(key)
    }
  )
  return promise
}

const getRevisionAwareKey = (key: string, revision: string) =>
  `${key}:r${revision}`

const getRevisionAwareCache = async <T extends ValidShoutboxCacheValue>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number,
  nowProvider: () => Date
) => {
  let revision: string
  try {
    revision = await getShoutboxCacheRevision()
  } catch (error) {
    console.error('[Shoutbox] Failed to read cache revision:', error)
    return getLocallyMerged(key, fetcher)
  }

  return getOrSet(getRevisionAwareKey(key, revision), fetcher, ttl, {
    staleTtl: 0,
    getCacheTtl: (value, now) => getShoutboxCacheTtl(value.validUntil, now),
    isCachedValueValid: (value) => isValidShoutboxCacheValue(value, nowProvider)
  })
}

export const getShoutboxCacheTtl = (validUntil: string, now = new Date()) =>
  Math.floor((new Date(validUntil).getTime() - now.getTime()) / 1000)

export const getShoutboxSMaxAge = (
  validUntil: string,
  now = new Date(),
  maximumSeconds = 30
) => {
  const remaining = Math.floor(
    (new Date(validUntil).getTime() - now.getTime()) / 1000
  )
  return Math.min(maximumSeconds, remaining)
}

export const getShoutboxCacheControl = (
  validUntil: string,
  personalized: boolean,
  now = new Date()
) => {
  if (personalized) return 'private, no-store'
  const maxAge = getShoutboxSMaxAge(validUntil, now)
  return maxAge > 0 ? `public, s-maxage=${maxAge}` : 'no-store'
}

const isValidShoutboxCacheValue = (
  value: ValidShoutboxCacheValue,
  nowProvider: () => Date
) => {
  const validUntil = new Date(value.validUntil).getTime()
  return Number.isFinite(validUntil) && validUntil > nowProvider().getTime()
}

export const getShoutboxCached = <T extends ValidShoutboxCacheValue>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number,
  nowProvider: () => Date = () => new Date()
) => getRevisionAwareCache(key, fetcher, ttl, nowProvider)

export const getShoutboxBannerCached = <T extends ValidShoutboxCacheValue>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number,
  nowProvider: () => Date = () => new Date()
) => getRevisionAwareCache(key, fetcher, ttl, nowProvider)

/**
 * Shoutbox writes affect every public list, game association and banner. Edge
 * purge is best effort: a committed business write must not be reported as a
 * failure merely because Redis or Cloudflare is unavailable.
 */
export const invalidateShoutboxCaches = async () => {
  try {
    await incrementShoutboxCacheRevision()
  } catch (error) {
    console.error('[Shoutbox] Failed to increment cache revision:', error)
  }

  try {
    await delKvPattern('shoutbox:*')
  } catch (error) {
    console.error('[Shoutbox] Failed to invalidate Redis cache:', error)
  }

  try {
    await purgePublicApiCache(['/api/shoutbox', '/api/shoutbox/banner'])
  } catch (error) {
    console.error('[Shoutbox] Failed to purge public API cache:', error)
  }
}
