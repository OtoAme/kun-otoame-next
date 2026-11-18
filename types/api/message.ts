import { MESSAGE_NOTIFICATION_TYPE } from '~/constants/message'
import type {
  NotificationCategory,
  NotificationEvent
} from '~/constants/notification'

export interface NotificationSummary {
  unread: number
  sequence: string
  categories: Record<NotificationCategory, { unread: number; sequence: string }>
}

export interface NotificationReadItem {
  id: number
  version: string
}

export interface NotificationList {
  messages: Message[]
  total: number
  upperId: number
  nextCursor: number | null
  contentSequence: string
}

export interface Message {
  id: number
  type: string
  content: string
  status: number
  link: string
  created: string | Date
  sender: KunUser | null
  eventType?: NotificationEvent | null
  category?: NotificationCategory
  contentVersion?: string
  updated?: string | Date
}

export interface CreateMessageType {
  type: (typeof MESSAGE_NOTIFICATION_TYPE)[number]
  content: string
  link: string
  sender_id?: number
  recipient_id?: number
  event_type?: NotificationEvent
}

export interface MessageUnreadStatus {
  hasUnreadNotification: boolean
  hasUnreadConversation: boolean
  preferenceVersion?: number | null
  notifications?: NotificationSummary | null
}
