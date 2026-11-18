import { create } from 'zustand'
import type { MessageUnreadStatus } from '~/types/api/message'
import { notificationSummarySchema } from '~/validations/notification'

interface MessageStore extends MessageUnreadStatus {
  setUnreadMessageStatus: (status: MessageUnreadStatus) => void
  setHasUnreadNotification: (hasUnreadNotification: boolean) => void
  setHasUnreadConversation: (hasUnreadConversation: boolean) => void
  resetUnreadMessageStatus: () => void
}

const initialUnreadMessageStatus: MessageUnreadStatus = {
  hasUnreadNotification: false,
  hasUnreadConversation: false,
  notifications: null
}

export const useMessageStore = create<MessageStore>()((set) => ({
  ...initialUnreadMessageStatus,
  setUnreadMessageStatus: (status) =>
    set((current) => ({
      ...status,
      notifications: notificationSummarySchema.safeParse(status.notifications)
        .success
        ? status.notifications
        : current.notifications
    })),
  setHasUnreadNotification: (hasUnreadNotification) =>
    set({ hasUnreadNotification }),
  setHasUnreadConversation: (hasUnreadConversation) =>
    set({ hasUnreadConversation }),
  resetUnreadMessageStatus: () => set(initialUnreadMessageStatus)
}))
