import { KunFetchError } from './kunFetch'

let unreadReadVersion = 0
export const beginUnreadRead = () => ++unreadReadVersion

export interface MessageSyncIdentity {
  context: string
  generation: number
}

export interface UnreadSummary {
  hasUnreadMessages: boolean
  hasUnreadChat: boolean
  preferenceVersion?: number | null
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
  reuseRecentSuccessOnResume?: boolean
  intervalMs?: number
  nextIntervalMs?: (result: Result) => number
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
  let latestReadVersion = 0
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
    latestReadVersion = beginUnreadRead()
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
      options.onSuccess(result)
      const requestedInterval = options.nextIntervalMs?.(result)
      const nextInterval =
        requestedInterval !== undefined && Number.isFinite(requestedInterval)
          ? requestedInterval
          : interval
      const nextDelay = options.nextIntervalMs
        ? Math.min(300_000, Math.max(100, jitter(nextInterval)))
        : jitter(interval)
      nextPollAt = Date.now() + nextDelay
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
      latestReadVersion = 0
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
      if (
        reason === 'resume' &&
        options.reuseRecentSuccessOnResume &&
        snapshot.lastSuccessAt !== null &&
        Date.now() >= snapshot.lastSuccessAt &&
        Date.now() - snapshot.lastSuccessAt < 5_000
      )
        return
      schedule(
        reason === 'resume'
          ? Math.max(Date.now(), lastRequestAt + 5_000)
          : Date.now()
      )
    },
    seed(
      value: unknown,
      succeededAt = Date.now(),
      readVersion = beginUnreadRead()
    ) {
      if (
        !identity ||
        disposed ||
        readVersion <= latestReadVersion ||
        (snapshot.lastSuccessAt !== null &&
          succeededAt < snapshot.lastSuccessAt) ||
        !(options.validate ?? isUnreadSummary)(value)
      )
        return false
      latestReadVersion = readVersion
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
    confirmIdentity() {
      if (snapshot.status !== 'invalid' || disposed) return
      snapshot = { ...snapshot, status: 'paused' }
      nextPollAt = Math.max(Date.now(), lastRequestAt + 5_000)
      notify()
      schedule()
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
  readVersion: number
  consumed: boolean
} | null = null

const sameIdentity = (left: MessageSyncIdentity, right: MessageSyncIdentity) =>
  left.context === right.context && left.generation === right.generation

export const seedSessionUnread = (
  identity: MessageSyncIdentity,
  unread: unknown,
  readVersion = beginUnreadRead()
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
  if (
    sessionSeed &&
    sameIdentity(sessionSeed.identity, identity) &&
    sessionSeed.readVersion >= readVersion
  )
    return false
  const seed = {
    identity,
    unread: {
      hasUnreadMessages: unread.hasUnreadNotification,
      hasUnreadChat: unread.hasUnreadConversation,
      ...('preferenceVersion' in unread
        ? {
            preferenceVersion:
              typeof unread.preferenceVersion === 'number'
                ? unread.preferenceVersion
                : null
          }
        : {})
    },
    succeededAt: Date.now(),
    readVersion,
    consumed: false
  }
  if (unreadBinding && sameIdentity(unreadBinding.identity, identity)) {
    if (
      !unreadBinding.scheduler.seed(seed.unread, seed.succeededAt, readVersion)
    )
      return false
    seed.consumed = true
  }
  sessionSeed = seed
  return true
}

export const bindUnreadSync = (
  identity: MessageSyncIdentity,
  scheduler: ReturnType<typeof createMessageSyncScheduler<UnreadSummary>>
) => {
  const binding = { identity, scheduler }
  unreadBinding = binding
  scheduler.setIdentity(identity)
  if (
    sessionSeed &&
    !sessionSeed.consumed &&
    sameIdentity(identity, sessionSeed.identity)
  ) {
    scheduler.seed(
      sessionSeed.unread,
      sessionSeed.succeededAt,
      sessionSeed.readVersion
    )
    sessionSeed.consumed = true
  }
  return () => {
    if (unreadBinding === binding) unreadBinding = null
  }
}

export const getUnreadSyncSnapshot = () =>
  unreadBinding?.scheduler.getSnapshot() ?? null
export const refreshUnreadSummary = (reason: 'resume' | 'manual' = 'manual') =>
  unreadBinding?.scheduler.refresh(reason)
