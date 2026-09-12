'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  resolveShoutboxCleanupMs,
  scheduleShoutboxDeadline
} from '~/utils/shoutboxVisibility'
import { useShoutboxQueryContext } from './ShoutboxQueryProvider'
import {
  buildShoutboxQueryKey,
  requestShoutboxQuery,
  SHOUTBOX_FIXED_QUERY_OPTIONS,
  shoutboxQueryOptionsFromKey,
  shoutboxQueryStaleTime
} from './core'
import type { ShoutboxVisibilityPayload } from '~/utils/shoutboxVisibility'
import type { ShoutboxRequestContext } from '~/types/api/shoutbox'
import type { ShoutboxQueryView } from './core'

interface UseShoutboxQueryArgs<TData extends ShoutboxVisibilityPayload> {
  view: ShoutboxQueryView
  /** List view only: 1-based page; home/banner stay on their fixed key. */
  page?: number
  patch?: string | null
  /** Key override: the /shoutbox container keys the query by the SSR request
   *  context until client-ready, so an SSR payload is never seeded under a
   *  mismatched API context. */
  scopeOverride?: ShoutboxRequestContext
  /** Consumer presence: a disabled consumer observes nothing and never
   *  drives requests (the site banner on admin preview pages). */
  active?: boolean
  /** Render-time projection for real-boundary cleanup; must be a stable
   *  module-level reference. Never mutates the cached payload. */
  project: (data: TData, nowMs: number) => TData
  /** Page switches keep showing the previous data while the new page loads;
   *  never across a scope (account/preference) change. */
  keepPreviousWhileLoading?: boolean
  /** Seed applied only when this exact key is created fresh (SSR first
   *  page); an existing — even errored or invalidated — query is never
   *  overwritten by it. */
  initialData?: TData
  /** SSR seeds pass 0: the payload then counts as received inside its own
   *  validity window, so an expired SSR page refetches immediately instead
   *  of backing off like a network response that arrived already stale. */
  initialDataUpdatedAt?: number
  /** Low-interference notice for a failed BACKGROUND refresh while old
   *  content stays on screen. */
  notifyOnBackgroundError?: (message: string) => void
}

export interface UseShoutboxQueryResult<TData> {
  /** Raw cached payload (never projected). */
  data: TData | undefined
  /** Payload after the render-time visibility projection. */
  displayData: TData | undefined
  status: 'pending' | 'error' | 'success'
  error: Error | null
  errorUpdatedAt: number
  fetchStatus: 'fetching' | 'idle' | 'paused'
  /** Manual retry: skips cooldowns; still a no-op while hidden/disabled. */
  refresh: () => void
}

/**
 * Reactive access to one public shoutbox query. The observer is fixed
 * disabled (see SHOUTBOX_FIXED_QUERY_OPTIONS): every request goes through
 * the shared gate — on mount once clientReady, at the absolute validUntil /
 * real-boundary deadlines, after the error cooldown, and on visibility
 * restore. Hidden pages never start automatic GETs, including first mount.
 */
export const useShoutboxQuery = <TData extends ShoutboxVisibilityPayload>({
  view,
  page = 1,
  patch = null,
  scopeOverride,
  active = true,
  project,
  keepPreviousWhileLoading = false,
  initialData,
  initialDataUpdatedAt,
  notifyOnBackgroundError
}: UseShoutboxQueryArgs<TData>): UseShoutboxQueryResult<TData> => {
  const { client, clientReady, scope } = useShoutboxQueryContext()

  const effectiveScope = scopeOverride ?? scope
  const queryKey = useMemo(
    () => buildShoutboxQueryKey(view, effectiveScope, page, patch),
    [view, effectiveScope, page, patch]
  )
  const options = useMemo(
    () => shoutboxQueryOptionsFromKey(queryKey),
    [queryKey]
  )
  if (!options) {
    throw new Error(`Unknown shoutbox query key: ${JSON.stringify(queryKey)}`)
  }
  const { cooldownMs } = options
  // Keys are runtime data, so the factory returns the untyped union; the
  // caller fixes the payload type via TData.
  const queryFn = options.queryFn as () => Promise<TData>

  const result = useQuery<TData, Error>(
    {
      queryKey,
      queryFn,
      staleTime: shoutboxQueryStaleTime,
      // Page-level "keep previous rows" is verified against the previous
      // query's actual key on EVERY render: only same-view, same-patch,
      // same-scope page switches may carry it — a scope (account/preference)
      // change can never resurrect the old payload on a later render.
      placeholderData: keepPreviousWhileLoading
        ? (previousData, previousQuery) => {
            if (previousData === undefined || !previousQuery) {
              return undefined
            }
            const previousKey = previousQuery.queryKey
            return previousKey[1] === queryKey[1] &&
              previousKey[2] === queryKey[2] &&
              previousKey[4] === queryKey[4] &&
              previousKey[5] === queryKey[5] &&
              previousKey[6] === queryKey[6]
              ? previousData
              : undefined
          }
        : undefined,
      // A disabled consumer unsubscribes its observer: it never counts as a
      // consumer for the write-notification path and receives nothing.
      subscribed: active,
      initialData,
      initialDataUpdatedAt,
      ...SHOUTBOX_FIXED_QUERY_OPTIONS
    },
    client
  )

  // The tick only re-renders; the projection always runs against the REAL
  // current time, so a slow first response that arrives past a boundary is
  // hidden on the very frame it lands.
  const [nowTick, setNowTick] = useState(0)
  const dataRef = useRef(result.data)
  dataRef.current = result.data

  const attempt = useCallback(
    async (trigger?: { force?: boolean }) => {
      if (!clientReady || !active) {
        return
      }
      // Freshness and the real-boundary decision are re-read from the cached
      // payload inside the gate, never from this render's snapshot.
      await requestShoutboxQuery(
        client,
        { queryKey, queryFn, cooldownMs },
        { force: trigger?.force }
      )
    },
    [client, clientReady, active, queryKey, queryFn, cooldownMs]
  )
  const attemptRef = useRef(attempt)
  attemptRef.current = attempt

  // Mount (once clientReady), key switches and ready flips all enter here.
  useEffect(() => {
    void attemptRef.current()
  }, [attempt])

  // Deadline scheduling: the freshness timer at absolute validUntil, the
  // real-boundary handling (which also re-renders the projection), the
  // arrival-expired backoff tick and the error-cooldown retry.
  const { data, status, errorUpdatedAt, dataUpdatedAt } = result
  // A due real boundary owns exactly one gated attempt per boundary value —
  // a payload whose boundary is already past on arrival (slow transit)
  // refetches right away instead of waiting for the TTL timer, while a
  // misbehaving payload can never loop.
  const boundaryAttemptedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!clientReady || !active) {
      return
    }
    const cancels: Array<() => void> = []
    const now = Date.now()
    const fireBoundary = (key: string) => {
      if (boundaryAttemptedRef.current === key) {
        return
      }
      boundaryAttemptedRef.current = key
      setNowTick(Date.now())
      void attemptRef.current()
    }
    if (data) {
      const validUntilMs = Date.parse(data.validUntil)
      if (Number.isFinite(validUntilMs)) {
        if (validUntilMs > now) {
          cancels.push(
            scheduleShoutboxDeadline(validUntilMs, () => {
              setNowTick(Date.now())
              void attemptRef.current()
            })
          )
        } else if (validUntilMs <= dataUpdatedAt) {
          // Expired already on arrival: exactly one retry when the backoff
          // ends; a natural deadline expiry is never delayed.
          const retryAt = dataUpdatedAt + cooldownMs
          if (retryAt > now) {
            cancels.push(
              scheduleShoutboxDeadline(retryAt, () => void attemptRef.current())
            )
          }
        }
      }
      const cleanupMs = resolveShoutboxCleanupMs(data)
      if (cleanupMs !== null) {
        const key = String(cleanupMs)
        if (Number.isFinite(cleanupMs) && cleanupMs > now) {
          cancels.push(
            scheduleShoutboxDeadline(cleanupMs, () => fireBoundary(key))
          )
        } else {
          fireBoundary(key)
        }
      }
    }
    if (status === 'error' && errorUpdatedAt > 0) {
      const retryAt = errorUpdatedAt + cooldownMs
      if (retryAt > now) {
        cancels.push(
          scheduleShoutboxDeadline(retryAt, () => void attemptRef.current())
        )
      }
    }
    return () => {
      for (const cancel of cancels) {
        cancel()
      }
    }
  }, [
    clientReady,
    active,
    data,
    dataUpdatedAt,
    status,
    errorUpdatedAt,
    cooldownMs
  ])

  // Visibility restore re-renders the projection against the CURRENT time
  // first, then lets the gate decide about a refetch.
  useEffect(() => {
    if (!clientReady || !active) {
      return
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        return
      }
      setNowTick(Date.now())
      void attemptRef.current()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [clientReady, active])

  // Background refresh failures keep the old content; surface them as a
  // low-interference notice rather than swapping the UI to an error state.
  const errorMessage = result.error ? result.error.message : ''
  const noticeRef = useRef(notifyOnBackgroundError)
  noticeRef.current = notifyOnBackgroundError
  useEffect(() => {
    if (status === 'error' && errorUpdatedAt > 0 && data !== undefined) {
      noticeRef.current?.(errorMessage || '网络错误，请稍后重试')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, errorUpdatedAt])

  const refresh = useCallback(() => {
    setNowTick(Date.now())
    void attemptRef.current({ force: true })
  }, [])

  const displayData = useMemo(
    // The tick only schedules the re-render; the projection always runs
    // against the real current time so a late-arriving payload that crossed
    // its boundary in transit is hidden on the frame it lands.
    () => (data === undefined ? undefined : project(data, Date.now())),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, nowTick, project]
  )

  return {
    data,
    displayData,
    status,
    error: result.error,
    errorUpdatedAt,
    fetchStatus: result.fetchStatus,
    refresh
  }
}
