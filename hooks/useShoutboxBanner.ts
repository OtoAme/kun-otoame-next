'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useShoutboxQuery } from '~/components/shoutbox/query/useShoutboxQuery'
import { projectShoutboxBannerDisplay } from '~/utils/shoutboxVisibility'
import type { ShoutboxBannerResponse, ShoutboxItem } from '~/types/api/shoutbox'

/**
 * Shared data protocol for the site and dashboard shoutbox banners, backed
 * by the shared public query cache (batch B): fetch the latest effective
 * important official message, remember dismissal per message id in
 * browser-local storage, and keep the payload fresh. `validUntil` is cache
 * freshness — reaching it refreshes in the background while the current
 * banner stays on screen. The real boundary (`visibilityUntil`, never
 * TTL-truncated) or the banner's own effectiveTo end hides it through the
 * render-time projection FIRST, even while a refresh is in flight or
 * failing. A failed first load stays silent and retries after the 60s
 * cooldown. Styling is intentionally not shared — each root layout renders
 * its own banner on top of this hook.
 */
export const SHOUTBOX_BANNER_DISMISS_STORAGE_KEY =
  'kun-shoutbox-banner-dismissed'

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

interface UseShoutboxBannerResult {
  banner: ShoutboxItem | null
  dismiss: () => void
}

export const useShoutboxBanner = (
  enabled: boolean
): UseShoutboxBannerResult => {
  const [dismissedIds, setDismissedIds] = useState<number[]>([])

  useEffect(() => {
    setDismissedIds(enabled ? readDismissedIds() : [])
  }, [enabled])

  const query = useShoutboxQuery<ShoutboxBannerResponse>({
    view: 'banner',
    active: enabled,
    project: projectShoutboxBannerDisplay
  })

  // Closing is remembered per message id: the NEXT important official message
  // carries a new id and therefore shows up again.
  const currentBannerRef = useRef<ShoutboxItem | null>(null)
  const current = enabled ? (query.displayData?.banner ?? null) : null
  currentBannerRef.current = current
  const dismiss = useCallback(() => {
    const banner = currentBannerRef.current
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

  const banner =
    current !== null && !dismissedIds.includes(current.id) ? current : null

  return { banner, dismiss }
}
