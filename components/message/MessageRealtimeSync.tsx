'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useMessageStore } from '~/store/messageStore'
import { useUserStore } from '~/store/userStore'
import { kunFetchGet } from '~/utils/kunFetch'

const VISIBLE_POLL_INTERVAL_MS = 15_000
const HIDDEN_POLL_INTERVAL_MS = 60_000
const UNREAD_STATUS_TIMEOUT_MS = 10_000

interface UnreadApiStatus {
  hasUnreadMessages: boolean
  hasUnreadChat: boolean
}

const isDocumentVisible = () =>
  typeof document === 'undefined' || document.visibilityState !== 'hidden'

export const MessageRealtimeSync = () => {
  const uid = useUserStore((state) => state.user.uid)
  const setUnreadMessageStatus = useMessageStore(
    (state) => state.setUnreadMessageStatus
  )
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearPollTimer = useCallback(() => {
    if (!timerRef.current) {
      return
    }

    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  useEffect(() => {
    if (!uid) {
      clearPollTimer()
      return
    }

    let ignore = false
    let unreadSyncInFlight = false

    const syncUnreadStatus = async () => {
      if (unreadSyncInFlight) {
        return
      }

      unreadSyncInFlight = true
      try {
        const res = await kunFetchGet<KunResponse<UnreadApiStatus>>(
          '/message/unread',
          undefined,
          { timeout: UNREAD_STATUS_TIMEOUT_MS }
        )
        if (ignore || typeof res === 'string') {
          return
        }

        setUnreadMessageStatus({
          hasUnreadNotification: res.hasUnreadMessages,
          hasUnreadConversation: res.hasUnreadChat
        })
      } catch {
      } finally {
        unreadSyncInFlight = false
        if (!ignore) {
          clearPollTimer()
          timerRef.current = setTimeout(
            syncUnreadStatus,
            isDocumentVisible()
              ? VISIBLE_POLL_INTERVAL_MS
              : HIDDEN_POLL_INTERVAL_MS
          )
        }
      }
    }

    const syncWhenVisible = () => {
      if (!isDocumentVisible()) {
        return
      }

      clearPollTimer()
      void syncUnreadStatus()
    }

    void syncUnreadStatus()
    document.addEventListener('visibilitychange', syncWhenVisible)

    return () => {
      ignore = true
      clearPollTimer()
      document.removeEventListener('visibilitychange', syncWhenVisible)
    }
  }, [clearPollTimer, setUnreadMessageStatus, uid])

  return null
}
