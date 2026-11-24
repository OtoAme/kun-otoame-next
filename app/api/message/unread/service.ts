import { getUnreadStatus } from '../service'
import type { MessageUnreadStatus } from '~/types/api/message'

export const getUnreadMessageStatus = async (
  uid: number
): Promise<MessageUnreadStatus> => {
  const summary = await getUnreadStatus(uid)
  return {
    hasUnreadNotification: summary.hasUnreadMessages,
    hasUnreadConversation: summary.hasUnreadChat,
    preferenceVersion: summary.preferenceVersion,
    notifications: summary.notifications
  }
}
