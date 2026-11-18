import { beforeEach, describe, expect, it } from 'vitest'
import {
  NOTIFICATION_CATEGORIES,
  isNotificationSequence,
  isNotificationSubscription,
  notificationCategory
} from '~/constants/notification'
import {
  notificationSummarySchema,
  readNotificationSchema
} from '~/validations/notification'
import { useMessageStore } from '~/store/messageStore'

const summary = () => ({
  unread: 0,
  sequence: '9007199254740993',
  categories: Object.fromEntries(
    NOTIFICATION_CATEGORIES.map((category) => [
      category,
      { unread: 0, sequence: '0' }
    ])
  )
})

describe('notification wire contracts', () => {
  beforeEach(() => useMessageStore.getState().resetUnreadMessageStatus())

  it('keeps bigint sequences exact and rejects overflow and coercion', () => {
    expect(isNotificationSequence('9223372036854775807')).toBe(true)
    for (const value of ['9223372036854775808', '01', '-1', '1e3', 1])
      expect(isNotificationSequence(value)).toBe(false)
    expect(notificationSummarySchema.parse(summary()).sequence).toBe(
      '9007199254740993'
    )
  })

  it('preserves a valid summary when an extension is absent, unavailable or malformed', () => {
    const store = useMessageStore.getState()
    const notifications = notificationSummarySchema.parse(summary())
    store.setUnreadMessageStatus({
      hasUnreadNotification: false,
      hasUnreadConversation: true,
      notifications
    })
    for (const candidate of [
      undefined,
      null,
      { ...notifications, unread: 1 }
    ]) {
      store.setUnreadMessageStatus({
        hasUnreadNotification: false,
        hasUnreadConversation: true,
        notifications: candidate as typeof notifications
      })
      expect(useMessageStore.getState().notifications).toEqual(notifications)
    }
    store.resetUnreadMessageStatus()
    expect(useMessageStore.getState().notifications).toBeNull()
  })

  it('accepts concrete bounded versions and rejects bulk unscoped requests', () => {
    expect(
      readNotificationSchema.safeParse({
        items: [{ id: 1, version: '9007199254740993' }]
      }).success
    ).toBe(true)
    for (const request of [
      {},
      { items: [] },
      { items: [{ id: 1, version: '0' }] },
      {
        items: Array.from({ length: 31 }, (_, index) => ({
          id: index + 1,
          version: '1'
        }))
      }
    ])
      expect(readNotificationSchema.safeParse(request).success).toBe(false)
  })

  it('has no configurable key for necessary notifications and maps historical types without guessing text', () => {
    expect(isNotificationSubscription('notification:site-announcement')).toBe(
      true
    )
    expect(isNotificationSubscription('notification:points')).toBe(false)
    expect(notificationCategory(null, 'system')).toBe('account')
    expect(notificationCategory(null, 'mention')).toBe('interaction')
    expect(notificationCategory('help-answer', 'comment')).toBe('help')
  })
})
