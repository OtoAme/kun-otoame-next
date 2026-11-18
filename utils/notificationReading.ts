import { useUserStore } from '~/store/userStore'
import { beginUnreadRead, seedSessionUnread } from '~/utils/messageSync'
import { KunFetchError, kunFetchPut } from '~/utils/kunFetch'
import { refreshUserSession } from '~/utils/sessionClient'
import { isNotificationVersion } from '~/constants/notification'
import {
  parseWorkspaceIssueNotification,
  workspaceIssueHref
} from '~/utils/workspaceRoutes'
import type { MessageSyncIdentity } from '~/utils/messageSync'
import type {
  NotificationReadItem,
  NotificationReadResponse,
  NotificationReadResult
} from '~/types/api/message'

export interface NotificationIdentity extends MessageSyncIdentity {
  uid: number
}

export const notificationIdentityKey = (identity: NotificationIdentity) =>
  `${identity.uid}:${identity.context}:${identity.generation}`

export const isCurrentNotificationIdentity = (
  identity: NotificationIdentity
) => {
  const session = useUserStore.getState()
  return (
    session.sessionStatus === 'authenticated' &&
    session.user.uid === identity.uid &&
    session.sessionContext === identity.context &&
    session.sessionGeneration === identity.generation
  )
}

const pending = new Map<string, Promise<NotificationReadResult>>()
const completed = new Map<string, NotificationReadResult>()
const readListeners = new Set<
  (identity: NotificationIdentity, item: NotificationReadItem) => void
>()

export const subscribeNotificationRead = (
  listener: (identity: NotificationIdentity, item: NotificationReadItem) => void
) => {
  readListeners.add(listener)
  return () => {
    readListeners.delete(listener)
  }
}

export const confirmNotificationItems = async (
  identity: NotificationIdentity,
  items: NotificationReadItem[],
  target?: string
): Promise<NotificationReadResult[]> => {
  if (!isCurrentNotificationIdentity(identity)) return []
  const prefix = notificationIdentityKey(identity)
  const unique = [
    ...new Map(
      items.map((item) => [item.id + ':' + item.version, item])
    ).values()
  ]
  const fresh = unique.filter(
    (item) =>
      !pending.has(`${prefix}:${item.id}:${item.version}`) &&
      !completed.has(`${prefix}:${item.id}:${item.version}`)
  )
  for (let offset = 0; offset < fresh.length; offset += 30) {
    const batch = fresh.slice(offset, offset + 30)
    const readVersion = beginUnreadRead()
    const request = kunFetchPut<KunResponse<NotificationReadResponse>>(
      '/message/read',
      {
        items: batch,
        ...(target === undefined ? {} : { target })
      },
      { timeout: 15_000, preserveErrorStatus: true }
    )
      .catch((error: unknown) => {
        if (
          error instanceof KunFetchError &&
          error.status === 401 &&
          isCurrentNotificationIdentity(identity)
        )
          void refreshUserSession()
        throw error
      })
      .then((response) => {
        if (
          !response ||
          typeof response === 'string' ||
          !Array.isArray(response.results) ||
          !response.summary
        )
          throw new Error(
            typeof response === 'string' ? response : '阅读确认暂不可用，请重试'
          )
        if (isCurrentNotificationIdentity(identity))
          seedSessionUnread(identity, response.summary, readVersion)
        return response
      })
    for (const item of batch) {
      const key = `${prefix}:${item.id}:${item.version}`
      const result = request.then((response) => {
        const result = response.results.find((result) => result.id === item.id)
        if (!result) throw new Error('阅读确认结果不完整，请重试')
        if (
          isCurrentNotificationIdentity(identity) &&
          (result.outcome === 'read' || result.outcome === 'already_read')
        ) {
          if (completed.size >= 500)
            completed.delete(completed.keys().next().value!)
          completed.set(key, result)
          for (const listener of readListeners) listener(identity, item)
        }
        return result
      })
      pending.set(key, result)
      void result
        .finally(() => {
          if (pending.get(key) === result) pending.delete(key)
        })
        .catch(() => {})
    }
  }
  return Promise.all(
    items.map(
      (item) =>
        completed.get(`${prefix}:${item.id}:${item.version}`) ??
        pending.get(`${prefix}:${item.id}:${item.version}`)!
    )
  )
}

export interface NotificationEntry {
  identity: NotificationIdentity
  item: NotificationReadItem
  target: string
  enteredAt: number
}

export const NOTIFICATION_ENTRY_PARAMETER = 'notification-entry'
const entries = new Map<string, NotificationEntry>()
let channel: BroadcastChannel | null = null
const entryLifetime = 10 * 60_000
const isEntry = (value: unknown): value is NotificationEntry => {
  const entry = value as Partial<NotificationEntry> | null
  return Boolean(
    entry &&
      Number.isSafeInteger(entry.identity?.uid) &&
      entry.identity!.uid > 0 &&
      typeof entry.identity?.context === 'string' &&
      entry.identity.context.length > 0 &&
      Number.isSafeInteger(entry.identity?.generation) &&
      entry.identity!.generation >= 0 &&
      Number.isSafeInteger(entry.item?.id) &&
      entry.item!.id > 0 &&
      isNotificationVersion(entry.item?.version) &&
      typeof entry.target === 'string' &&
      entry.target.length > 0 &&
      entry.target.length <= 4096 &&
      typeof entry.enteredAt === 'number' &&
      Number.isFinite(entry.enteredAt) &&
      Date.now() >= entry.enteredAt &&
      Date.now() - entry.enteredAt <= entryLifetime
  )
}
const entryChannel = () => {
  if (channel || typeof BroadcastChannel === 'undefined') return channel
  channel = new BroadcastChannel('kun-notification-entry')
  channel.addEventListener('message', (event) => {
    const message = event.data
    if (message?.kind !== 'request' || typeof message.token !== 'string') return
    const entry = entries.get(message.token)
    if (
      !isEntry(entry) ||
      !isCurrentNotificationIdentity(entry.identity) ||
      message.uid !== entry.identity.uid ||
      message.context !== entry.identity.context
    )
      return
    channel?.postMessage({ kind: 'entry', token: message.token, entry })
  })
  return channel
}

export const notificationEntryHref = (target: string, token: string) => {
  if (!target || typeof window === 'undefined') return target
  try {
    const issueId = parseWorkspaceIssueNotification(target)
    const url = new URL(
      issueId ? workspaceIssueHref(issueId) : target,
      window.location.href
    )
    if (url.origin !== window.location.origin) return target
    url.searchParams.set(NOTIFICATION_ENTRY_PARAMETER, token)
    return url.pathname + url.search + url.hash
  } catch {
    return target
  }
}

export const rememberNotificationEntry = (
  token: string,
  value: Omit<NotificationEntry, 'enteredAt'>
) => {
  const entry = { ...value, enteredAt: Date.now() }
  if (!isEntry(entry) || !isCurrentNotificationIdentity(value.identity)) return
  if (entries.size >= 50) entries.delete(entries.keys().next().value!)
  entries.set(token, entry)
  entryChannel()
}

export const notificationTargetMatches = (target: string, current: string) => {
  try {
    const issueId = parseWorkspaceIssueNotification(target)
    const destination = new URL(
      issueId ? workspaceIssueHref(issueId) : target,
      window.location.origin
    )
    const actual = new URL(current, window.location.origin)
    actual.searchParams.delete(NOTIFICATION_ENTRY_PARAMETER)
    return (
      destination.origin === window.location.origin &&
      destination.href === actual.href
    )
  } catch {
    return false
  }
}

export const resolveNotificationEntry = async (
  identity: NotificationIdentity,
  token: string,
  current: string
): Promise<NotificationEntry | null> => {
  if (
    !isCurrentNotificationIdentity(identity) ||
    !/^[a-f0-9-]{36}$/.test(token)
  )
    return null
  const valid = (entry: unknown): entry is NotificationEntry =>
    isEntry(entry) &&
    entry.identity.uid === identity.uid &&
    entry.identity.context === identity.context &&
    notificationTargetMatches(entry.target, current)
  const local = entries.get(token)
  if (valid(local) && local!.identity.generation === identity.generation)
    return local!
  const bus = entryChannel()
  if (!bus) return null
  return new Promise((resolve) => {
    const finish = (entry: NotificationEntry | null) => {
      clearTimeout(timeout)
      bus.removeEventListener('message', receive)
      resolve(isCurrentNotificationIdentity(identity) ? entry : null)
    }
    const receive = (event: MessageEvent) => {
      if (
        event.data?.kind !== 'entry' ||
        event.data.token !== token ||
        !valid(event.data.entry)
      )
        return
      finish({ ...event.data.entry, identity })
    }
    const timeout = setTimeout(() => finish(null), 1000)
    bus.addEventListener('message', receive)
    bus.postMessage({
      kind: 'request',
      token,
      uid: identity.uid,
      context: identity.context
    })
  })
}

useUserStore.subscribe((state, previous) => {
  if (
    state.sessionStatus === 'guest' ||
    state.user.uid !== previous.user.uid ||
    state.sessionContext !== previous.sessionContext ||
    state.sessionGeneration !== previous.sessionGeneration
  )
    completed.clear()
  for (const [token, entry] of entries)
    if (!isCurrentNotificationIdentity(entry.identity)) entries.delete(token)
})
