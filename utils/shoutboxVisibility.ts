/**
 * Shared cleanup-boundary resolution for the shoutbox refresh state machines
 * (home/patch feed, /shoutbox container, site banner).
 *
 * `validUntil` is cache freshness and stays TTL-truncated: reaching it only
 * means "refresh in the background". `visibilityUntil` is the server's known
 * next REAL official effective/expiry boundary — the conservative cleanup
 * point. The field is tri-state: a string cleans up at that instant, an
 * explicit null means the server knows no upcoming boundary (nothing is
 * time-cleaned), and an absent field (old payload) falls back to `validUntil`,
 * preserving the original drop-at-validUntil behavior. Field presence is
 * tested with Object.hasOwn so null is never confused with "old payload".
 *
 * Returns epoch milliseconds, `null` for "no known boundary", or NaN for a
 * malformed value which callers must treat as already due.
 */
export interface ShoutboxVisibilityPayload {
  validUntil: string
  visibilityUntil?: string | null
}

export const resolveShoutboxCleanupMs = (
  payload: ShoutboxVisibilityPayload
): number | null => {
  if (!Object.hasOwn(payload, 'visibilityUntil')) {
    return new Date(payload.validUntil).getTime()
  }
  const boundary = payload.visibilityUntil
  return boundary == null ? null : new Date(boundary).getTime()
}

// setTimeout clamps its delay to a 32-bit signed integer: a real boundary
// further than ~24.8 days out overflows and would fire IMMEDIATELY. Wait in
// bounded segments instead and re-check the absolute deadline on every wake —
// an early wake only re-arms the next segment, so the callback never requests
// or cleans up before the deadline itself. Returns a cancel function for the
// currently pending segment.
const MAX_TIMER_SEGMENT_MS = 2 ** 31 - 1

export const scheduleShoutboxDeadline = (
  deadlineMs: number,
  onDue: () => void
): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | null = null
  const arm = () => {
    timer = null
    const remaining = deadlineMs - Date.now()
    if (remaining <= 0) {
      onDue()
      return
    }
    timer = setTimeout(arm, Math.min(remaining, MAX_TIMER_SEGMENT_MS))
  }
  arm()
  return () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
}

// --- Display projections (B3) ------------------------------------------------
// Real-boundary cleanup happens ONLY here, at render time, so the cached
// payload, its receive timestamp and any error state are never touched. A
// timer in the consumer hook simply re-renders with a fresh `nowMs`.

interface ShoutboxPinnedPayload {
  pinned: unknown
}

/** Global streams (home, /shoutbox): at/past the real boundary the pinned
 *  slot is hidden — it may already belong to the next official message —
 *  while ordinary rows stay; they are public history regardless of age. */
export const projectShoutboxGlobalListDisplay = <
  T extends ShoutboxPinnedPayload & ShoutboxVisibilityPayload
>(
  payload: T,
  nowMs: number
): T => {
  const cleanupMs = resolveShoutboxCleanupMs(payload)
  const due =
    cleanupMs !== null && (!Number.isFinite(cleanupMs) || cleanupMs <= nowMs)
  if (!due || payload.pinned === null) {
    return payload
  }
  return { ...payload, pinned: null }
}

/** Game-scoped lists keep their whole history: the boundary only schedules
 *  a refetch, nothing is hidden client-side. */
export const projectShoutboxPatchListDisplay = <T>(payload: T): T => payload

interface ShoutboxBannerPayload extends ShoutboxVisibilityPayload {
  banner: { effectiveTo: string | null } | null
}

/** The banner hides at the real boundary or when its own effective window
 *  has ended (or is malformed); a `banner: null` payload projects to
 *  itself. */
export const projectShoutboxBannerDisplay = <T extends ShoutboxBannerPayload>(
  payload: T,
  nowMs: number
): T => {
  if (payload.banner === null) {
    return payload
  }
  const cleanupMs = resolveShoutboxCleanupMs(payload)
  const boundaryDue =
    cleanupMs !== null && (!Number.isFinite(cleanupMs) || cleanupMs <= nowMs)
  const effectiveToMs = payload.banner.effectiveTo
    ? Date.parse(payload.banner.effectiveTo)
    : NaN
  const ended = !Number.isFinite(effectiveToMs) || effectiveToMs <= nowMs
  if (!boundaryDue && !ended) {
    return payload
  }
  return { ...payload, banner: null }
}
