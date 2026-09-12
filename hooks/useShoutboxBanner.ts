'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { kunFetchGet } from '~/utils/kunFetch'
import type { ShoutboxBannerResponse, ShoutboxItem } from '~/types/api/shoutbox'

/**
 * Shared data protocol for the site and dashboard shoutbox banners: fetch the
 * latest effective important official message, remember dismissal per message
 * id in browser-local storage, and refresh at the payload's validUntil
 * boundary. Styling is intentionally not shared — each root layout renders
 * its own banner on top of this hook.
 */
export const SHOUTBOX_BANNER_DISMISS_STORAGE_KEY = 'kun-shoutbox-banner-dismissed'

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
  // issues a fresh fetch, instead of being locked out forever.
  const inFlightRef = useRef<Promise<void> | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

    if (!enabled) {
      applyPayload(null)
      setDismissedIds([])
      return
    }

    const scheduleAfter = (delay: number) => {
      clearTimer()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        // At a boundary the current payload may no longer be valid: drop it
        // BEFORE the refetch starts, never keep an expired banner on screen.
        applyPayload(null)
        void load()
      }, delay)
    }

    const load = async (): Promise<void> => {
      while (inFlightRef.current) {
        await inFlightRef.current
      }
      const generation = generationRef.current
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
            // the base cache duration instead of hot-looping.
            scheduleAfter(SHOUTBOX_BANNER_RETRY_MS)
            return
          }
          applyPayload(result)
          const validUntilMs = new Date(result.validUntil).getTime()
          const delay = validUntilMs - Date.now()
          if (!Number.isFinite(validUntilMs) || delay <= 0) {
            applyPayload(null)
            scheduleAfter(SHOUTBOX_BANNER_RETRY_MS)
            return
          }
          scheduleAfter(delay)
        } catch {
          if (generation !== generationRef.current) {
            return
          }
          scheduleAfter(SHOUTBOX_BANNER_RETRY_MS)
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
    }

    setDismissedIds(readDismissedIds())
    void load()

    // Returning from the background revalidates the payload against the
    // CURRENT time before anything is shown again: expired payloads are
    // dropped first and only then refetched.
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        return
      }
      const current = payloadRef.current
      if (!current) {
        void load()
        return
      }
      const validUntilMs = new Date(current.validUntil).getTime()
      const stale =
        !Number.isFinite(validUntilMs) ||
        validUntilMs <= Date.now() ||
        !isBannerEffective(current.banner, Date.now())
      if (stale) {
        applyPayload(null)
        void load()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      generationRef.current += 1
      clearTimer()
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
