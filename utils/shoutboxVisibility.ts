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
