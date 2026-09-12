'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { kunFetchGet } from '~/utils/kunFetch'
import type { ShoutboxListResponse } from '~/types/api/shoutbox'

/**
 * Single-page shoutbox feed used by the home module and the per-game strip.
 * It refreshes at the payload's validUntil boundary — dropping content that
 * may no longer be visible BEFORE the refetch starts — and revalidates the
 * same way when the page becomes visible again.
 *
 * Boundary handling differs by mode: the global stream drops the pinned slot
 * unconditionally (validUntil may mark the NEXT official message's start
 * while the current pinned one's own interval still runs; list rows inside
 * the 60 slots stay visible regardless of age), while a patch-scoped payload
 * can contain rows that are visible solely through the three-month retention
 * rule — the client cannot recompute the slot boundary, so the whole payload
 * is dropped and the server re-decides. Failed refreshes keep any still-valid
 * global rows and retry after the base cache duration; a dropped patch
 * payload stays safely empty until a fetch succeeds again.
 */

const GLOBAL_RETRY_MS = 60_000
const PATCH_RETRY_MS = 300_000

interface Options {
  patch?: string
  enabled?: boolean
}

interface Result {
  data: ShoutboxListResponse | null
  loading: boolean
  error: string
  retry: () => void
}

export const useShoutboxFeed = ({
  patch,
  enabled = true
}: Options): Result => {
  const [data, setData] = useState<ShoutboxListResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const dataRef = useRef<ShoutboxListResponse | null>(null)
  const generationRef = useRef(0)
  // Promise-based in-flight slot: remounts await an interrupted request (its
  // result is generation-discarded) and then fetch fresh, instead of being
  // locked out by a stale boolean.
  const inFlightRef = useRef<Promise<void> | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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

  const dropStale = useCallback(() => {
    const current = dataRef.current
    if (!current) {
      return
    }
    if (patch) {
      applyData(null)
      return
    }
    // validUntil may mark the NEXT official message's effectiveFrom while the
    // current pinned message's own interval still runs. Either way the pinned
    // slot is no longer guaranteed, so it is removed unconditionally before
    // the refetch; ordinary rows stay on screen.
    if (current.pinned !== null) {
      applyData({ ...current, pinned: null })
    }
  }, [applyData, patch])

  const loadRef = useRef<() => Promise<void>>(async () => {})

  const scheduleAfter = useCallback(
    (delay: number) => {
      clearTimer()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        dropStale()
        void loadRef.current()
      }, delay)
    },
    [clearTimer, dropStale]
  )

  const load = useCallback(async (): Promise<void> => {
    while (inFlightRef.current) {
      await inFlightRef.current
    }
    const generation = generationRef.current
    const request = (async () => {
      try {
        const result = await kunFetchGet<ShoutboxListResponse | string>(
          '/shoutbox',
          { page: 1, limit: 6, ...(patch ? { patch } : {}) }
        )
        if (generation !== generationRef.current) {
          return
        }
        if (typeof result === 'string') {
          setError(result || '获取小喇叭失败，请稍后重试')
          scheduleAfter(retryMs)
          return
        }
        setError('')
        applyData(result)
        const validUntilMs = new Date(result.validUntil).getTime()
        const delay = validUntilMs - Date.now()
        if (!Number.isFinite(validUntilMs) || delay <= 0) {
          dropStale()
          scheduleAfter(retryMs)
          return
        }
        scheduleAfter(delay)
      } catch {
        if (generation !== generationRef.current) {
          return
        }
        setError('网络错误，请稍后重试')
        scheduleAfter(retryMs)
      } finally {
        if (generation === generationRef.current) {
          setLoading(false)
        }
      }
    })()
    inFlightRef.current = request
    try {
      await request
    } finally {
      if (inFlightRef.current === request) {
        inFlightRef.current = null
      }
    }
  }, [patch, retryMs, applyData, dropStale, scheduleAfter])

  loadRef.current = load

  useEffect(() => {
    if (!enabled) {
      return
    }
    void loadRef.current()

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        return
      }
      const current = dataRef.current
      if (!current) {
        void loadRef.current()
        return
      }
      const validUntilMs = new Date(current.validUntil).getTime()
      if (!Number.isFinite(validUntilMs) || validUntilMs <= Date.now()) {
        dropStale()
        void loadRef.current()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      generationRef.current += 1
      clearTimer()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [enabled, dropStale, clearTimer])

  const retry = useCallback(() => {
    setLoading(dataRef.current === null)
    setError('')
    void loadRef.current()
  }, [])

  return { data, loading, error, retry }
}
