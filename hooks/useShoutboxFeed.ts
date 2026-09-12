'use client'

import { useShoutboxQuery } from '~/components/shoutbox/query/useShoutboxQuery'
import {
  projectShoutboxGlobalListDisplay,
  projectShoutboxPatchListDisplay
} from '~/utils/shoutboxVisibility'
import type { ShoutboxListResponse } from '~/types/api/shoutbox'

/**
 * Single-page shoutbox feed used by the home module and the per-game strip,
 * backed by the shared public query cache (batch B). Freshness follows the
 * absolute `validUntil`; real official boundaries (`visibilityUntil`, never
 * TTL-truncated) hide the pinned slot through the render-time projection and
 * schedule exactly one gated refetch. A failed refresh keeps the current
 * content and retries after the scope cooldown (60s global, 300s patch);
 * patch-scoped history is never cleared client-side.
 */

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

export const useShoutboxFeed = ({
  patch,
  home = false,
  enabled = true
}: Options): Result => {
  const query = useShoutboxQuery<ShoutboxListResponse>({
    view: patch ? 'list' : home ? 'home' : 'list',
    patch: patch ?? null,
    active: enabled,
    project: patch
      ? projectShoutboxPatchListDisplay
      : projectShoutboxGlobalListDisplay
  })

  return {
    data: query.displayData ?? null,
    // pending covers the idle (never-yet-requested) first frame too, so a
    // cold load shows the spinner and never flashes the empty state.
    loading: query.status === 'pending',
    error: query.error ? query.error.message : '',
    retry: query.refresh
  }
}
