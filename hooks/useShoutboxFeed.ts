'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { SHOUTBOX_PAGE_SIZE } from '~/constants/shoutbox'
import { kunFetchGet } from '~/utils/kunFetch'
import {
  resolveShoutboxCleanupMs,
  scheduleShoutboxDeadline
} from '~/utils/shoutboxVisibility'
import type { ShoutboxListResponse } from '~/types/api/shoutbox'

/**
 * Single-page shoutbox feed used by the home module and the per-game strip.
 *
 * Each payload carries two deadlines. `validUntil` is cache freshness: when
 * it passes the hook refreshes in the background and KEEPS the current
 * content on screen until the new response replaces it atomically — no
 * clear-then-refill flicker at every TTL. `visibilityUntil` (resolved via
 * resolveShoutboxCleanupMs, never TTL-truncated) is the server's known next
 * real official boundary: when it passes the stale parts are dropped
 * conservatively first, even if a refresh is still in flight or failing, so
 * an expired official message never stays visible on network trouble.
 *
 * Boundary handling differs by mode: the home stream drops the pinned slot
 * unconditionally (the boundary may mark the NEXT official message's start
 * while the current pinned one's own interval still runs; ordinary rows are
 * public history and stay visible regardless of age), while a patch-scoped
 * payload's visibility is decided server-side, so the whole payload is
 * dropped and the server re-decides. Failed refreshes keep any still-valid
 * home rows and retry after the base cache duration; a dropped patch
 * payload stays safely empty until a fetch succeeds again.
 */

const GLOBAL_RETRY_MS = 60_000
const PATCH_RETRY_MS = 300_000

interface Options {
  patch?: string
  /** Home module mode: fetches the dedicated `view=home` payload (15 rows). */
  home?: boolean
  enabled?: boolean
}

interface Result {
  data: ShoutboxListResponse | null
  loading: boolean
  error: string
  retry: () => void
}

export const useShoutboxFeed = ({ patch, enabled = true }: Options): Result => {
  const [data, setData] = useState<ShoutboxListResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const dataRef = useRef<ShoutboxListResponse | null>(null)
  const generationRef = useRef(0)
  // Promise-based in-flight slot: remounts await an interrupted request (its
  // result is generation-discarded) and then fetch fresh, instead of being
  // locked out by a stale boolean. The generation tag lets same-generation
  // automatic callers merge into the running request instead of queueing.
  const inFlightRef = useRef<Promise<void> | null>(null)
  const inFlightGenerationRef = useRef(0)
  // Two independent timers per payload: the refresh timer arms at validUntil
  // (cache freshness), the cleanup timer at the real visibility boundary. The
  // cleanup side stores a cancel function: the boundary may sit beyond
  // setTimeout's 32-bit delay range (see scheduleShoutboxDeadline).
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cleanupCancelRef = useRef<(() => void) | null>(null)
  const retryMs = patch ? PATCH_RETRY_MS : GLOBAL_RETRY_MS

  const applyData = useCallback((next: ShoutboxListResponse | null) => {
    dataRef.current = next
    setData(next)
  }, [])

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const clearCleanupTimer = useCallback(() => {
    cleanupCancelRef.current?.()
    cleanupCancelRef.current = null
  }, [])

  const dropStale = useCallback(() => {
    const current = dataRef.current
    if (!current) {
      return
    }
    if (patch) {
      applyData(null)
      return
    }
    // The boundary may mark the NEXT official message's effectiveFrom while
    // the current pinned message's own interval still runs. Either way the
    // pinned slot is no longer guaranteed, so it is removed; ordinary rows
    // stay on screen.
    if (current.pinned !== null) {
      applyData({ ...current, pinned: null })
    }
  }, [applyData, patch])

  const loadRef = useRef<(force?: boolean) => Promise<void>>(async () => {})

  // Both timers funnel into here. A due visibility boundary owns the moment:
  // stale official content is dropped FIRST, then exactly one load starts. A
  // plain freshness expiry keeps the current content on screen, and a timer
  // firing while a request is already in flight never queues a duplicate —
  // that request's completion applies fresh data and re-arms both timers.
  const fireScheduled = useCallback(() => {
    const current = dataRef.current
    if (current) {
      const cleanupMs = resolveShoutboxCleanupMs(current)
      if (
        cleanupMs !== null &&
        (!Number.isFinite(cleanupMs) || cleanupMs <= Date.now())
      ) {
        clearCleanupTimer()
        dropStale()
      }
    }
    if (inFlightRef.current === null) {
      void loadRef.current()
    }
  }, [clearCleanupTimer, dropStale])

  const scheduleRefresh = useCallback(
    (delay: number) => {
      clearTimer()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        fireScheduled()
      }, delay)
    },
    [clearTimer, fireScheduled]
  )

  const scheduleCleanup = useCallback(
    (deadlineMs: number) => {
      clearCleanupTimer()
      cleanupCancelRef.current = scheduleShoutboxDeadline(deadlineMs, () => {
        cleanupCancelRef.current = null
        fireScheduled()
      })
    },
    [clearCleanupTimer, fireScheduled]
  )

  const load = useCallback(
    async (force = false): Promise<void> => {
      // Capture the generation BEFORE waiting on any in-flight request: a call
      // queued behind a slow one must not adopt a newer generation after a
      // patch switch/disable/unmount and keep working in this stale closure.
      const generation = generationRef.current
      while (inFlightRef.current) {
        // Same-generation automatic callers merge into the running request —
        // its completion applies fresh data and re-arms both timers. Only a
        // stale-generation or forced (manual) call waits for the slot.
        if (!force && inFlightGenerationRef.current === generation) {
          return
        }
        await inFlightRef.current
        if (generation !== generationRef.current) {
          return
        }
      }
      const request = (async () => {
        try {
          const result = await kunFetchGet<ShoutboxListResponse | string>(
            '/shoutbox',
            patch
              ? { page: 1, limit: SHOUTBOX_PAGE_SIZE, patch }
              : { view: 'home' }
          )
          if (generation !== generationRef.current) {
            return
          }
          if (typeof result === 'string') {
            setError(result || '获取小喇叭失败，请稍后重试')
            // Keep whatever is still on screen; the already-armed cleanup
            // timer still drops official content at its real boundary.
            scheduleRefresh(retryMs)
            return
          }
          setError('')
          applyData(result)
          const now = Date.now()
          const validUntilMs = new Date(result.validUntil).getTime()
          // A TTL already past on arrival (slow transit, or the server's
          // safe-empty fallback) only backs off freshness — the applied
          // payload stays on screen instead of flickering out. Cleanup is
          // judged independently against the REAL boundary below.
          if (!Number.isFinite(validUntilMs) || validUntilMs <= now) {
            scheduleRefresh(retryMs)
          } else {
            scheduleRefresh(validUntilMs - now)
          }
          const cleanupMs = resolveShoutboxCleanupMs(result)
          if (cleanupMs === null) {
            clearCleanupTimer()
          } else if (!Number.isFinite(cleanupMs) || cleanupMs <= now) {
            // The real boundary has already passed: drop the possibly-expired
            // official content at once; the freshness timer above refetches.
            clearCleanupTimer()
            dropStale()
          } else {
            scheduleCleanup(cleanupMs)
          }
        } catch {
          if (generation !== generationRef.current) {
            return
          }
          setError('网络错误，请稍后重试')
          scheduleRefresh(retryMs)
        } finally {
          if (generation === generationRef.current) {
            setLoading(false)
          }
        }
      })()
      inFlightRef.current = request
      inFlightGenerationRef.current = generation
      try {
        await request
      } finally {
        if (inFlightRef.current === request) {
          inFlightRef.current = null
        }
      }
    },
    [
      patch,
      retryMs,
      applyData,
      dropStale,
      scheduleRefresh,
      scheduleCleanup,
      clearCleanupTimer
    ]
  )

  loadRef.current = load

  useEffect(() => {
    if (!enabled) {
      return
    }
    void loadRef.current()

    // Returning from the background revalidates against the CURRENT time: a
    // passed visibility boundary drops stale official content first, while a
    // merely stale cache triggers a background refresh that keeps the
    // current content until the new response lands.
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        return
      }
      const current = dataRef.current
      if (!current) {
        void loadRef.current()
        return
      }
      const cleanupMs = resolveShoutboxCleanupMs(current)
      if (
        cleanupMs !== null &&
        (!Number.isFinite(cleanupMs) || cleanupMs <= Date.now())
      ) {
        fireScheduled()
        return
      }
      const validUntilMs = new Date(current.validUntil).getTime()
      if (!Number.isFinite(validUntilMs) || validUntilMs <= Date.now()) {
        void loadRef.current()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      generationRef.current += 1
      clearTimer()
      clearCleanupTimer()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [enabled, fireScheduled, clearTimer, clearCleanupTimer])

  const retry = useCallback(() => {
    setLoading(dataRef.current === null)
    setError('')
    // Manual refreshes (including after a publish/edit) force a fresh request
    // once any in-flight one settles instead of merging into it.
    void loadRef.current(true)
  }, [])

  return { data, loading, error, retry }
}
