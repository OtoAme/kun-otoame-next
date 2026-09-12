import {
  SHOUTBOX_BANNER_CACHE_DURATION,
  SHOUTBOX_LIST_CACHE_DURATION,
  SHOUTBOX_PATCH_CACHE_DURATION
} from '~/config/cache'
import { delKvPattern, getOrSet } from '~/lib/redis'
import { purgePublicApiCache } from '~/app/api/utils/purgeCloudflareCache'

export {
  SHOUTBOX_BANNER_CACHE_DURATION,
  SHOUTBOX_LIST_CACHE_DURATION,
  SHOUTBOX_PATCH_CACHE_DURATION
}

export const getShoutboxCacheKey = (patch: string | null, page: number) =>
  patch ? `shoutbox:patch:v1:${patch}:p${page}` : `shoutbox:list:v1:p${page}`

export const getShoutboxBannerCacheKey = () => 'shoutbox:banner:v1'

type ValidShoutboxCacheValue = { validUntil: string }

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
) =>
  getOrSet(key, fetcher, ttl, {
    staleTtl: 0,
    getCacheTtl: (value, now) => getShoutboxCacheTtl(value.validUntil, now),
    isCachedValueValid: (value) => isValidShoutboxCacheValue(value, nowProvider)
  })

export const getShoutboxBannerCached = <T extends ValidShoutboxCacheValue>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number,
  nowProvider: () => Date = () => new Date()
) =>
  getOrSet(key, fetcher, ttl, {
    staleTtl: 0,
    getCacheTtl: (value, now) => getShoutboxCacheTtl(value.validUntil, now),
    isCachedValueValid: (value) => isValidShoutboxCacheValue(value, nowProvider)
  })

/**
 * Shoutbox writes affect every public list, game association and banner. Edge
 * purge is best effort: a committed business write must not be reported as a
 * failure merely because Redis or Cloudflare is unavailable.
 */
export const invalidateShoutboxCaches = async () => {
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
