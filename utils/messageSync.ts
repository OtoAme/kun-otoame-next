import { KunFetchError } from './kunFetch'

export interface MessageSyncIdentity {
  context: string
  generation: number
}

export interface UnreadSummary {
  hasUnreadMessages: boolean
  hasUnreadChat: boolean
}

export const isUnreadSummary = (value: unknown): value is UnreadSummary =>
  !!value &&
  typeof value === 'object' &&
  'hasUnreadMessages' in value &&
  typeof value.hasUnreadMessages === 'boolean' &&
  'hasUnreadChat' in value &&
  typeof value.hasUnreadChat === 'boolean'

export interface MessageSyncSnapshot {
  status: 'paused' | 'syncing' | 'synced' | 'error' | 'invalid'
  lastSuccessAt: number | null
  nextAllowedAt: number
  failures: number
  errorKind: string | null
}

interface SchedulerOptions<Result> {
  request: (signal: AbortSignal) => Promise<Result>
  onSuccess: (result: Result) => void
  onInvalid?: () => void
  onChange?: (snapshot: MessageSyncSnapshot) => void
  validate?: (value: unknown) => boolean
  intervalMs?: number
  random?: () => number
}

export const createMessageSyncScheduler = <Result = UnreadSummary>(
  options: SchedulerOptions<Result>
) => {
  const interval = options.intervalMs ?? 60_000
  const random = options.random ?? Math.random
  let identity: MessageSyncIdentity | null = null
  let enabled = false
  let disposed = false
  let revision = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: { controller: AbortController; revision: number } | null = null
  let lastRequestAt = -Infinity
  let nextPollAt = 0
  let snapshot: MessageSyncSnapshot = {
    status: 'paused',
    lastSuccessAt: null,
    nextAllowedAt: 0,
    failures: 0,
    errorKind: null
  }
  const jitter = (delay: number) => Math.round(delay * (0.9 + random() * 0.2))
  const notify = () => options.onChange?.({ ...snapshot })
  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  const active = () =>
    enabled && identity !== null && !disposed && snapshot.status !== 'invalid'
  const cancelPending = () => {
    revision++
    pending?.controller.abort()
    pending = null
  }
  const schedule = (due = nextPollAt) => {
    clearTimer()
    if (!active() || pending) return
    const target = Math.max(due, snapshot.nextAllowedAt)
    timer = setTimeout(
      () => {
        timer = undefined
        if (Date.now() < target) schedule(target)
        else void run()
      },
      Math.min(2_147_483_647, Math.max(0, target - Date.now()))
    )
  }
  const run = async () => {
    if (!active() || pending) return
    if (Date.now() < snapshot.nextAllowedAt) {
      schedule(snapshot.nextAllowedAt)
      return
    }
    const current = { controller: new AbortController(), revision }
    pending = current
    lastRequestAt = Date.now()
    snapshot = { ...snapshot, status: 'syncing' }
    notify()
    try {
      const result = await options.request(current.controller.signal)
      if (current.revision !== revision || disposed) return
      if (options.validate && !options.validate(result)) {
        throw new KunFetchError('Invalid message response', 'http', 200)
      }
      snapshot = {
        status: 'synced',
        lastSuccessAt: Date.now(),
        nextAllowedAt: 0,
        failures: 0,
        errorKind: null
      }
      nextPollAt = Date.now() + jitter(interval)
      options.onSuccess(result)
    } catch (error) {
      if (current.revision !== revision || disposed) return
      if (error instanceof KunFetchError && error.kind === 'aborted') {
        snapshot = { ...snapshot, status: 'paused' }
        nextPollAt = Date.now() + jitter(interval)
      } else if (error instanceof KunFetchError && error.status === 401) {
        snapshot = { ...snapshot, status: 'invalid', errorKind: 'http' }
        options.onInvalid?.()
      } else {
        const failures = snapshot.failures + 1
        const delay = [60_000, 120_000, 240_000, 300_000][
          Math.min(failures - 1, 3)
        ]
        const retryAfter =
          error instanceof KunFetchError ? error.retryAfterMs : null
        const wait = Math.max(jitter(delay), retryAfter ?? 0)
        snapshot = {
          ...snapshot,
          status: 'error',
          failures,
          errorKind: error instanceof KunFetchError ? error.kind : 'network',
          nextAllowedAt: Date.now() + wait
        }
        nextPollAt = snapshot.nextAllowedAt
      }
    } finally {
      if (pending === current) {
        pending = null
        notify()
        schedule()
      }
    }
  }
  return {
    setIdentity(next: MessageSyncIdentity | null) {
      if (
        identity?.context === next?.context &&
        identity?.generation === next?.generation
      )
        return
      clearTimer()
      cancelPending()
      identity = next
      snapshot = {
        status: 'paused',
        lastSuccessAt: null,
        nextAllowedAt: 0,
        failures: 0,
        errorKind: null
      }
      nextPollAt = 0
      lastRequestAt = -Infinity
      notify()
      schedule()
    },
    setEnabled(next: boolean) {
      if (enabled === next || disposed) return
      enabled = next
      if (!next) {
        clearTimer()
        cancelPending()
        if (snapshot.status === 'syncing')
          snapshot = { ...snapshot, status: 'paused' }
        notify()
      } else {
        schedule(snapshot.lastSuccessAt === null ? 0 : nextPollAt)
      }
    },
    refresh(reason: 'resume' | 'manual' = 'manual') {
      if (pending || !active()) return
      schedule(
        reason === 'resume'
          ? Math.max(Date.now(), lastRequestAt + 5_000)
          : Date.now()
      )
    },
    seed(value: unknown, succeededAt = Date.now()) {
      if (
        !identity ||
        disposed ||
        !(options.validate ?? isUnreadSummary)(value)
      )
        return false
      cancelPending()
      snapshot = {
        ...snapshot,
        status: 'synced',
        lastSuccessAt: succeededAt,
        failures: 0,
        errorKind: null
      }
      nextPollAt = succeededAt + jitter(interval)
      options.onSuccess(value as Result)
      notify()
      schedule()
      return true
    },
    invalidatePending() {
      clearTimer()
      cancelPending()
    },
    getSnapshot: () => ({ ...snapshot }),
    dispose() {
      disposed = true
      enabled = false
      clearTimer()
      cancelPending()
    }
  }
}

let unreadBinding: {
  identity: MessageSyncIdentity
  scheduler: ReturnType<typeof createMessageSyncScheduler<UnreadSummary>>
} | null = null
let sessionSeed: {
  identity: MessageSyncIdentity
  unread: UnreadSummary
  succeededAt: number
} | null = null

const sameIdentity = (left: MessageSyncIdentity, right: MessageSyncIdentity) =>
  left.context === right.context && left.generation === right.generation

export const seedSessionUnread = (
  identity: MessageSyncIdentity,
  unread: unknown
) => {
  if (
    !identity.context ||
    !unread ||
    typeof unread !== 'object' ||
    !('hasUnreadNotification' in unread) ||
    typeof unread.hasUnreadNotification !== 'boolean' ||
    !('hasUnreadConversation' in unread) ||
    typeof unread.hasUnreadConversation !== 'boolean'
  )
    return false
  sessionSeed = {
    identity,
    unread: {
      hasUnreadMessages: unread.hasUnreadNotification,
      hasUnreadChat: unread.hasUnreadConversation
    },
    succeededAt: Date.now()
  }
  if (unreadBinding && sameIdentity(unreadBinding.identity, identity)) {
    unreadBinding.scheduler.seed(sessionSeed.unread, sessionSeed.succeededAt)
  }
  return true
}

export const bindUnreadSync = (
  identity: MessageSyncIdentity,
  scheduler: ReturnType<typeof createMessageSyncScheduler<UnreadSummary>>
) => {
  const binding = { identity, scheduler }
  unreadBinding = binding
  scheduler.setIdentity(identity)
  if (sessionSeed && sameIdentity(identity, sessionSeed.identity)) {
    scheduler.seed(sessionSeed.unread, sessionSeed.succeededAt)
  }
  return () => {
    if (unreadBinding === binding) unreadBinding = null
  }
}

export const refreshUnreadSummary = (reason: 'resume' | 'manual' = 'manual') =>
  unreadBinding?.scheduler.refresh(reason)
