'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { kunFetchGet } from '~/utils/kunFetch'
import {
  resolveShoutboxCleanupMs,
  scheduleShoutboxDeadline
} from '~/utils/shoutboxVisibility'
import type { ShoutboxBannerResponse, ShoutboxItem } from '~/types/api/shoutbox'

/**
 * Shared data protocol for the site and dashboard shoutbox banners: fetch the
 * latest effective important official message, remember dismissal per message
 * id in browser-local storage, and keep the payload fresh. `validUntil` is
 * cache freshness — reaching it refreshes in the background while the current
 * banner stays on screen until the new response replaces it atomically.
 * `visibilityUntil` (resolved via resolveShoutboxCleanupMs, never
 * TTL-truncated) is the server's known next real official boundary — reaching
 * it drops the banner FIRST, even while a refresh is still in flight or
 * failing. Styling is intentionally not shared — each root layout renders its
 * own banner on top of this hook.
 */
export const SHOUTBOX_BANNER_DISMISS_STORAGE_KEY =
  'kun-shoutbox-banner-dismissed'

// Mirrors the banner base cache duration (60s); only used as the backoff when
// a refresh fails, so an open page never keeps a stale banner forever.
export const SHOUTBOX_BANNER_RETRY_MS = 60_000

const MAX_DISMISSED_IDS = 20

// Dismissal is remembered per message id as a small bounded list, so a
// superseded banner that becomes effective again stays dismissed while any
// new important message (new id) still shows up. The original single numeric
// string value is accepted for backward compatibility.
const readDismissedIds = (): number[] => {
  try {
    const raw = window.localStorage.getItem(SHOUTBOX_BANNER_DISMISS_STORAGE_KEY)
    if (!raw) {
      return []
    }
    if (/^\d+$/.test(raw)) {
      return [Number(raw)]
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    const ids = parsed.filter(
      (value): value is number => Number.isInteger(value) && value > 0
    )
    // Cap and deduplicate here too, so an old or malformed-but-valid stored
    // array cannot grow the in-memory set beyond the bound.
    return Array.from(new Set(ids)).slice(-MAX_DISMISSED_IDS)
  } catch {
    return []
  }
}

const writeDismissedIds = (ids: number[]) => {
  try {
    window.localStorage.setItem(
      SHOUTBOX_BANNER_DISMISS_STORAGE_KEY,
      JSON.stringify(ids.slice(-MAX_DISMISSED_IDS))
    )
  } catch {
    // Storage unavailable: dismissal lasts only for this page session.
  }
}

const isBannerEffective = (
  banner: ShoutboxItem | null,
  nowMs: number
): banner is ShoutboxItem => {
  if (!banner) {
    return false
  }
  const effectiveTo = banner.effectiveTo
    ? new Date(banner.effectiveTo).getTime()
    : NaN
  return Number.isFinite(effectiveTo) && effectiveTo > nowMs
}

interface UseShoutboxBannerResult {
  banner: ShoutboxItem | null
  dismiss: () => void
}

export const useShoutboxBanner = (
  enabled: boolean
): UseShoutboxBannerResult => {
  const [payload, setPayload] = useState<ShoutboxBannerResponse | null>(null)
  const [dismissedIds, setDismissedIds] = useState<number[]>([])
  const payloadRef = useRef<ShoutboxBannerResponse | null>(null)
  const generationRef = useRef(0)
  // Promise-based in-flight slot: a remount after an interrupted request
  // awaits the stale promise (whose result is generation-discarded) and then
  // issues a fresh fetch, instead of being locked out forever. The generation
  // tag lets same-generation callers merge into the running request.
  const inFlightRef = useRef<Promise<void> | null>(null)
  const inFlightGenerationRef = useRef(0)
  // Two independent timers per payload: the refresh timer arms at validUntil
  // (cache freshness), the cleanup timer at the real visibility boundary. The
  // cleanup side stores a cancel function: the boundary may sit beyond
  // setTimeout's 32-bit delay range (see scheduleShoutboxDeadline).
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cleanupCancelRef = useRef<(() => void) | null>(null)

  const applyPayload = useCallback((next: ShoutboxBannerResponse | null) => {
    payloadRef.current = next
    setPayload(next)
  }, [])

  // Closing is remembered per message id: the NEXT important official message
  // carries a new id and therefore shows up again.
  const dismiss = useCallback(() => {
    const banner = payloadRef.current?.banner
    if (!banner) {
      return
    }
    setDismissedIds((current) => {
      if (current.includes(banner.id)) {
        return current
      }
      const next = [...current, banner.id].slice(-MAX_DISMISSED_IDS)
      writeDismissedIds(next)
      return next
    })
  }, [])

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
    const clearCleanupTimer = () => {
      cleanupCancelRef.current?.()
      cleanupCancelRef.current = null
    }

    if (!enabled) {
      applyPayload(null)
      setDismissedIds([])
      return
    }

    // Both timers funnel into here. A due visibility boundary owns the
    // moment: the banner is dropped FIRST (never keep an expired banner on
    // screen), then exactly one load starts. A plain freshness expiry keeps
    // the current banner while the refresh runs in the background, and a
    // timer firing while a request is already in flight never queues a
    // duplicate — that request's completion re-arms both timers.
    const fireScheduled = () => {
      const current = payloadRef.current
      if (current) {
        const cleanupMs = resolveShoutboxCleanupMs(current)
        if (
          cleanupMs !== null &&
          (!Number.isFinite(cleanupMs) || cleanupMs <= Date.now())
        ) {
          clearCleanupTimer()
          applyPayload(null)
        }
      }
      if (inFlightRef.current === null) {
        void load()
      }
    }

    const scheduleRefresh = (delay: number) => {
      clearTimer()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        fireScheduled()
      }, delay)
    }

    const scheduleCleanup = (deadlineMs: number) => {
      clearCleanupTimer()
      cleanupCancelRef.current = scheduleShoutboxDeadline(deadlineMs, () => {
        cleanupCancelRef.current = null
        fireScheduled()
      })
    }

    const load = async (): Promise<void> => {
      // Capture the generation BEFORE waiting on any in-flight request: a
      // caller queued behind a slow one must not adopt a newer generation
      // after a disable/unmount and keep working in this stale closure.
      const generation = generationRef.current
      while (inFlightRef.current) {
        // Same-generation callers merge into the running request; only a
        // stale-generation one waits for the slot and re-validates after.
        if (inFlightGenerationRef.current === generation) {
          return
        }
        await inFlightRef.current
        if (generation !== generationRef.current) {
          return
        }
      }
      const request = (async () => {
        try {
          const result = await kunFetchGet<ShoutboxBannerResponse | string>(
            '/shoutbox/banner'
          )
          if (generation !== generationRef.current) {
            return
          }
          if (typeof result === 'string') {
            // Business error: keep whatever is still valid and retry after
            // the base cache duration instead of hot-looping. The armed
            // cleanup timer still drops the banner at its real boundary.
            scheduleRefresh(SHOUTBOX_BANNER_RETRY_MS)
            return
          }
          applyPayload(result)
          const now = Date.now()
          const validUntilMs = new Date(result.validUntil).getTime()
          // A TTL already past on arrival (slow transit, or the server's
          // safe-empty fallback) only backs off freshness — the applied
          // payload stays instead of flickering out. Cleanup is judged
          // independently against the REAL boundary below.
          if (!Number.isFinite(validUntilMs) || validUntilMs <= now) {
            scheduleRefresh(SHOUTBOX_BANNER_RETRY_MS)
          } else {
            scheduleRefresh(validUntilMs - now)
          }
          const cleanupMs = resolveShoutboxCleanupMs(result)
          if (cleanupMs === null) {
            clearCleanupTimer()
          } else if (!Number.isFinite(cleanupMs) || cleanupMs <= now) {
            // The real boundary has already passed: drop the possibly
            // expired banner at once; the freshness timer above refetches.
            clearCleanupTimer()
            applyPayload(null)
          } else {
            scheduleCleanup(cleanupMs)
          }
        } catch {
          if (generation !== generationRef.current) {
            return
          }
          scheduleRefresh(SHOUTBOX_BANNER_RETRY_MS)
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
    }

    setDismissedIds(readDismissedIds())
    void load()

    // Returning from the background revalidates the payload against the
    // CURRENT time before anything is shown again: a passed real boundary or
    // an ended banner interval drops first, while a merely stale cache only
    // triggers a background refresh that keeps the current banner.
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        return
      }
      const current = payloadRef.current
      if (!current) {
        void load()
        return
      }
      const now = Date.now()
      const cleanupMs = resolveShoutboxCleanupMs(current)
      if (
        cleanupMs !== null &&
        (!Number.isFinite(cleanupMs) || cleanupMs <= now)
      ) {
        fireScheduled()
        return
      }
      if (!isBannerEffective(current.banner, now)) {
        applyPayload(null)
        if (inFlightRef.current === null) {
          void load()
        }
        return
      }
      const validUntilMs = new Date(current.validUntil).getTime()
      if (!Number.isFinite(validUntilMs) || validUntilMs <= now) {
        void load()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      generationRef.current += 1
      clearTimer()
      clearCleanupTimer()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [enabled, applyPayload])

  const current = payload?.banner ?? null
  const banner =
    enabled &&
    current !== null &&
    isBannerEffective(current, Date.now()) &&
    !dismissedIds.includes(current.id)
      ? current
      : null

  return { banner, dismiss }
}
