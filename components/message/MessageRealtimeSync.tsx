'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useMessageSyncActivity } from '~/hooks/useMessageSyncActivity'
import { useMessageStore } from '~/store/messageStore'
import { useUserStore } from '~/store/userStore'
import { kunFetchGet } from '~/utils/kunFetch'
import { observePreferenceVersion } from '~/utils/preferenceClient'
import { refreshUserSession } from '~/utils/sessionClient'
import {
  bindUnreadSync,
  createMessageSyncScheduler,
  isUnreadSummary,
  type UnreadSummary
} from '~/utils/messageSync'

export const MessageRealtimeSync = () => {
  const [syncFailed, setSyncFailed] = useState(false)
  const pathname = usePathname()
  const activity = useMessageSyncActivity(
    /^\/message\/chat\/[^/]+/.test(pathname)
  )
  const { sessionStatus, sessionContext, sessionGeneration } = useUserStore()
  const schedulerRef = useRef<ReturnType<
    typeof createMessageSyncScheduler
  > | null>(null)
  const activityRef = useRef(activity)
  activityRef.current = activity

  useEffect(() => {
    if (!sessionContext) return
    const context = sessionContext
    const generation = sessionGeneration
    const isCurrent = () => {
      const state = useUserStore.getState()
      return (
        state.sessionStatus === 'authenticated' &&
        state.sessionContext === context &&
        state.sessionGeneration === generation
      )
    }
    const scheduler = createMessageSyncScheduler({
      request: (signal) =>
        kunFetchGet<UnreadSummary>('/message/unread', undefined, {
          timeout: 15_000,
          signal,
          preserveErrorStatus: true
        }),
      validate: isUnreadSummary,
      reuseRecentSuccessOnResume: true,
      onSuccess: (unread) => {
        if (!isCurrent()) return
        observePreferenceVersion(unread.preferenceVersion)
        useMessageStore.getState().setUnreadMessageStatus({
          hasUnreadNotification: unread.hasUnreadMessages,
          hasUnreadConversation: unread.hasUnreadChat,
          notifications: unread.notifications
        })
      },
      onChange: (snapshot) => {
        if (isCurrent()) setSyncFailed(snapshot.status === 'error')
      },
      onInvalid: () => {
        if (isCurrent()) void refreshUserSession()
      }
    })
    schedulerRef.current = scheduler
    const unbind = bindUnreadSync({ context, generation }, scheduler)
    scheduler.setEnabled(
      activityRef.current.enabled &&
        useUserStore.getState().sessionStatus === 'authenticated'
    )
    const unsubscribe = useUserStore.subscribe((state) => {
      const current =
        state.sessionContext === context &&
        state.sessionGeneration === generation &&
        state.sessionStatus === 'authenticated'
      if (current) scheduler.confirmIdentity()
      scheduler.setEnabled(current && activityRef.current.enabled)
    })
    return () => {
      unsubscribe()
      unbind()
      scheduler.dispose()
      if (schedulerRef.current === scheduler) schedulerRef.current = null
    }
  }, [sessionContext, sessionGeneration])

  useEffect(() => {
    const scheduler = schedulerRef.current
    scheduler?.setEnabled(activity.enabled && sessionStatus === 'authenticated')
    if (
      activity.enabled &&
      sessionStatus === 'authenticated' &&
      activity.resumeVersion > 0
    )
      scheduler?.refresh('resume')
  }, [activity.enabled, activity.resumeVersion, sessionStatus])

  return syncFailed && sessionStatus === 'authenticated' ? (
    <span role="status" className="sr-only">
      消息同步暂时不可用，将自动重试
    </span>
  ) : null
}
