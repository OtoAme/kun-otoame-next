import { useUserStore } from '~/store/userStore'
import type { NotificationList } from '~/types/api/message'
import {
  notificationIdentityKey,
  subscribeNotificationRead,
  type NotificationIdentity
} from './notificationReading'

export interface NotificationViewPage extends NotificationList {
  cursor?: number
  justRead: number[]
  scrollY: number
}
export interface NotificationView {
  owner: string
  key: string
  pages: NotificationViewPage[]
  index: number
}
let owner: string | null = null
const views = new Map<string, NotificationView>()

subscribeNotificationRead((identity, item) => {
  if (notificationIdentityKey(identity) !== owner) return
  for (const view of views.values()) {
    for (const page of view.pages) {
      page.messages = page.messages.map((message) => {
        if (message.id !== item.id || message.contentVersion !== item.version)
          return message
        if (!page.justRead.includes(item.id)) page.justRead.push(item.id)
        return { ...message, status: 1 }
      })
    }
  }
})

useUserStore.subscribe((state) => {
  const next =
    state.sessionStatus !== 'guest' &&
    state.user.uid > 0 &&
    state.sessionContext
      ? notificationIdentityKey({
          uid: state.user.uid,
          context: state.sessionContext,
          generation: state.sessionGeneration
        })
      : null
  if (next !== owner) {
    views.clear()
    owner = next
  }
})

export const notificationView = (
  identity: NotificationIdentity,
  key: string,
  reset = false
): NotificationView => {
  const next = notificationIdentityKey(identity)
  if (next !== owner) {
    views.clear()
    owner = next
  }
  const existing = views.get(key)
  if (existing && !reset) return existing
  if (views.size >= 12) views.delete(views.keys().next().value!)
  const view = { owner: next, key, pages: [], index: 0 }
  views.set(key, view)
  return view
}
