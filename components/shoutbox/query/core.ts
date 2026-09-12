import { SHOUTBOX_PAGE_SIZE } from '~/constants/shoutbox'
import { kunFetchGet } from '~/utils/kunFetch'
import { resolveShoutboxCleanupMs } from '~/utils/shoutboxVisibility'
import type {
  ShoutboxBannerResponse,
  ShoutboxHomeResponse,
  ShoutboxListResponse,
  ShoutboxRequestContext
} from '~/types/api/shoutbox'
import type { QueryClient } from '@tanstack/react-query'

/**
 * Shared pure data layer for the browser-side shoutbox cache (plan batch B).
 * Both root layouts hold their own QueryClient; only this code is shared.
 * This module stays free of React and runtime query imports so the SSR page
 * can reuse the key/normalize helpers.
 */

export const SHOUTBOX_QUERY_ROOT = 'shoutbox' as const

export type ShoutboxQueryView = 'home' | 'list' | 'banner'

export const SHOUTBOX_GLOBAL_COOLDOWN_MS = 60_000
export const SHOUTBOX_PATCH_COOLDOWN_MS = 300_000
const SHOUTBOX_QUERY_TIMEOUT_MS = 10_000
const SHOUTBOX_QUERY_GC_TIME_MS = 5 * 60_000

const LIST_ERROR_MESSAGE = '获取小喇叭失败，请稍后重试'
const NETWORK_ERROR_MESSAGE = '网络错误，请稍后重试'

/** Fixed observer options: the cache is reactive, but every network request
 *  goes through the gate below — never through TanStack's own triggers.
 *  gcTime is Infinity during SSR so a per-request client never arms a GC
 *  timer that would pin the request's cache in the server process. */
export const SHOUTBOX_FIXED_QUERY_OPTIONS = {
  enabled: false,
  retry: false,
  retryOnMount: false,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  networkMode: 'always',
  gcTime:
    typeof window === 'undefined'
      ? Number.POSITIVE_INFINITY
      : SHOUTBOX_QUERY_GC_TIME_MS
} as const

export const normalizeShoutboxBlockedTags = (ids: readonly number[]) =>
  [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))].sort(
    (a, b) => a - b
  )

export const normalizeShoutboxContext = (
  context: ShoutboxRequestContext
): ShoutboxRequestContext => ({
  uid: Number.isInteger(context.uid) && context.uid > 0 ? context.uid : 0,
  nsfw:
    typeof context.nsfw === 'string' && context.nsfw !== ''
      ? context.nsfw
      : 'sfw',
  blockedTags: normalizeShoutboxBlockedTags(context.blockedTags)
})

export const getShoutboxContextKeyPart = (
  context: ShoutboxRequestContext
): string => `${context.uid}|${context.nsfw}|${context.blockedTags.join(',')}`

export const buildShoutboxQueryKey = (
  view: ShoutboxQueryView,
  context: ShoutboxRequestContext,
  page = 1,
  patch: string | null = null
): readonly unknown[] => [
  SHOUTBOX_QUERY_ROOT,
  view,
  patch,
  page,
  context.uid,
  context.nsfw,
  context.blockedTags.join(',')
]

export const isShoutboxQueryKey = (queryKey: readonly unknown[]) =>
  queryKey[0] === SHOUTBOX_QUERY_ROOT

export const shoutboxQueryKeyMatchesContext = (
  queryKey: readonly unknown[],
  context: ShoutboxRequestContext
) =>
  isShoutboxQueryKey(queryKey) &&
  queryKey[4] === context.uid &&
  queryKey[5] === context.nsfw &&
  queryKey[6] === context.blockedTags.join(',')

// --- fetchers ----------------------------------------------------------------

// Marker class: business (string) responses and validation failures are
// display-ready; only unknown/network failures get the generic message.
class ShoutboxQueryError extends Error {}

const parseListPayload = (raw: unknown): ShoutboxListResponse => {
  if (
    raw &&
    typeof raw === 'object' &&
    Array.isArray((raw as ShoutboxListResponse).shoutboxes) &&
    typeof (raw as ShoutboxListResponse).validUntil === 'string'
  ) {
    return raw as ShoutboxListResponse
  }
  throw new ShoutboxQueryError(LIST_ERROR_MESSAGE)
}

const parseBannerPayload = (raw: unknown): ShoutboxBannerResponse => {
  if (
    raw &&
    typeof raw === 'object' &&
    'banner' in raw &&
    typeof (raw as ShoutboxBannerResponse).validUntil === 'string'
  ) {
    return raw as ShoutboxBannerResponse
  }
  throw new ShoutboxQueryError(LIST_ERROR_MESSAGE)
}

const requestShoutboxPayload = async <T>(
  url: string,
  query: Record<string, string | number> | undefined,
  parse: (raw: unknown) => T
): Promise<T> => {
  let raw: unknown
  try {
    raw = await kunFetchGet<unknown>(url, query, {
      timeout: SHOUTBOX_QUERY_TIMEOUT_MS
    })
  } catch (error) {
    if (error instanceof ShoutboxQueryError) {
      throw error
    }
    throw new ShoutboxQueryError(NETWORK_ERROR_MESSAGE)
  }
  // kunFetchGet surfaces every non-2xx body (including the 503 string) as a
  // string: never let it become a cached success.
  if (typeof raw === 'string') {
    throw new ShoutboxQueryError(raw.trim() === '' ? LIST_ERROR_MESSAGE : raw)
  }
  return parse(raw)
}

export const fetchShoutboxHome = (): Promise<ShoutboxHomeResponse> =>
  requestShoutboxPayload('/shoutbox', { view: 'home' }, (raw) => {
    const list = parseListPayload(raw)
    return {
      ...list,
      hasMore:
        typeof (raw as ShoutboxHomeResponse).hasMore === 'boolean'
          ? (raw as ShoutboxHomeResponse).hasMore
          : false
    }
  })

export const fetchShoutboxList = (
  page: number,
  patch: string | null
): Promise<ShoutboxListResponse> =>
  requestShoutboxPayload(
    '/shoutbox',
    patch
      ? { page, limit: SHOUTBOX_PAGE_SIZE, patch }
      : { page, limit: SHOUTBOX_PAGE_SIZE },
    parseListPayload
  )

export const fetchShoutboxBanner = (): Promise<ShoutboxBannerResponse> =>
  requestShoutboxPayload('/shoutbox/banner', undefined, parseBannerPayload)

// --- query options -------------------------------------------------------------

export interface ShoutboxQueryOptions {
  queryKey: readonly unknown[]
  queryFn: () => Promise<unknown>
  cooldownMs: number
}

/** Single options factory: consumers and the write-invalidation path rebuild
 *  the same queryFn/cooldown from a key, so the two can never drift apart. */
export const shoutboxQueryOptionsFromKey = (
  queryKey: readonly unknown[]
): ShoutboxQueryOptions | null => {
  if (!isShoutboxQueryKey(queryKey)) {
    return null
  }
  const view = queryKey[1] as ShoutboxQueryView
  const patch = queryKey[2] as string | null
  const page = queryKey[3] as number
  switch (view) {
    case 'home':
      return {
        queryKey,
        queryFn: fetchShoutboxHome,
        cooldownMs: SHOUTBOX_GLOBAL_COOLDOWN_MS
      }
    case 'banner':
      return {
        queryKey,
        queryFn: fetchShoutboxBanner,
        cooldownMs: SHOUTBOX_GLOBAL_COOLDOWN_MS
      }
    case 'list':
      return {
        queryKey,
        queryFn: () => fetchShoutboxList(page, patch),
        cooldownMs: patch
          ? SHOUTBOX_PATCH_COOLDOWN_MS
          : SHOUTBOX_GLOBAL_COOLDOWN_MS
      }
    default:
      return null
  }
}

/** Observer staleTime: the remaining absolute freshness window measured from
 *  the moment THIS payload was received; 0 when there is no usable data.
 *  Declared structurally so it fits any Query instantiation. */
export const shoutboxQueryStaleTime = (query: {
  state: { data: unknown; dataUpdatedAt: number }
}): number => {
  const data = query.state.data as { validUntil?: unknown } | undefined
  if (!data || typeof data.validUntil !== 'string') {
    return 0
  }
  const validUntilMs = Date.parse(data.validUntil)
  if (!Number.isFinite(validUntilMs)) {
    return 0
  }
  return Math.max(0, validUntilMs - query.state.dataUpdatedAt)
}

// --- the single request gate -----------------------------------------------------

export interface ShoutboxGateTrigger {
  /** Manual retries and write-success refreshes skip cooldowns. */
  force?: boolean
}

/**
 * The only way public shoutbox queries reach the network. fetchQuery itself
 * merges concurrent same-key callers; this gate decides whether a call may
 * start at all, reading the CURRENT cached payload — never a caller's stale
 * snapshot — for every check:
 * - hidden pages (and SSR, where document is undefined is allowed through
 *   because effects never run there) never start a GET;
 * - fresh, not invalidated and no due real boundary: skip;
 * - expired already on arrival (validUntil not later than its own receive
 *   time): back off one cooldown from that receive time, so a permanently
 *   expired payload can never hot-loop — a NATURAL deadline expiry is not
 *   delayed;
 * - a recent failure: honor the 60/300s error cooldown from the key's own
 *   errorUpdatedAt (it survives remounts and focus toggling).
 */
export const requestShoutboxQuery = async (
  client: QueryClient,
  options: ShoutboxQueryOptions,
  trigger: ShoutboxGateTrigger = {}
): Promise<void> => {
  if (
    typeof document !== 'undefined' &&
    document.visibilityState !== 'visible'
  ) {
    return
  }
  const query = client
    .getQueryCache()
    .find({ queryKey: options.queryKey, exact: true })
  const now = Date.now()
  if (!trigger.force && query) {
    const state = query.state
    if (
      state.status === 'error' &&
      now - state.errorUpdatedAt < options.cooldownMs
    ) {
      return
    }
    const data = state.data as { validUntil?: unknown } | undefined
    if (data !== undefined && typeof data.validUntil === 'string') {
      const validUntilMs = Date.parse(data.validUntil)
      if (Number.isFinite(validUntilMs)) {
        const cleanupMs = resolveShoutboxCleanupMs(
          data as Parameters<typeof resolveShoutboxCleanupMs>[0]
        )
        const boundaryDue =
          cleanupMs !== null &&
          (!Number.isFinite(cleanupMs) || cleanupMs <= now)
        if (validUntilMs > now && !state.isInvalidated && !boundaryDue) {
          return
        }
        if (
          validUntilMs <= state.dataUpdatedAt &&
          now - state.dataUpdatedAt < options.cooldownMs
        ) {
          return
        }
      }
    }
  }
  try {
    // fetchQuery already merges a concurrent same-key request in flight;
    // stale-timer double fires are additionally guarded by the gate reading
    // the CURRENT cached payload for every check.
    await client.fetchQuery({
      queryKey: options.queryKey,
      queryFn: options.queryFn,
      staleTime: 0,
      networkMode: 'always',
      retry: false
    })
  } catch {
    // Cancelled (a write superseded it) or failed: the query state carries
    // the outcome; the gate itself never throws.
  }
}

/**
 * After any successful public-visibility write (publish, edit, self-delete,
 * report, official write, moderation): cancel pre-write in-flight results,
 * mark every public query stale without auto-refetching (observers are
 * fixed-disabled), then refetch only the currently observed ones through the
 * gate — and only while the page is visible. Hidden pages keep the stale
 * mark and follow the normal rules when they return. The call needs the live
 * provider context: not ready, or a query outside the CURRENT scope, means
 * no request; a consumer whose observer is unsubscribed (disabled) does not
 * count towards getObserversCount.
 */
export const notifyShoutboxPublicWrite = async (
  context: {
    client: QueryClient
    /** Live read at call time: a write that started before an account or
     *  preference switch must act on the CURRENT scope, not the render-time
     *  closure it was captured in. */
    getCurrent: () => {
      clientReady: boolean
      scope: ShoutboxRequestContext
    }
  } | null
): Promise<void> => {
  if (!context) {
    return
  }
  const { client } = context
  const { clientReady, scope } = context.getCurrent()
  if (!clientReady) {
    return
  }
  const rootKey = [SHOUTBOX_QUERY_ROOT]
  await client.cancelQueries({ queryKey: rootKey })
  await client.invalidateQueries({ queryKey: rootKey, refetchType: 'none' })
  if (
    typeof document !== 'undefined' &&
    document.visibilityState !== 'visible'
  ) {
    return
  }
  const queries = client.getQueryCache().findAll({ queryKey: rootKey })
  await Promise.all(
    queries.map((query) => {
      if (query.getObserversCount() === 0) {
        return undefined
      }
      if (!shoutboxQueryKeyMatchesContext(query.queryKey, scope)) {
        return undefined
      }
      const options = shoutboxQueryOptionsFromKey(query.queryKey)
      return options
        ? requestShoutboxQuery(client, options, { force: true })
        : undefined
    })
  )
}
