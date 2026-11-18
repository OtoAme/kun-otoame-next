'use client'

import { useEffect, useRef, useState } from 'react'
import { useMounted } from '~/hooks/useMounted'
import { useMessageSyncActivity } from '~/hooks/useMessageSyncActivity'
import { KunLoading } from '~/components/kun/Loading'
import { KunNull } from '~/components/kun/Null'
import { KunPagination } from '~/components/kun/Pagination'
import { ConversationCard } from './ConversationCard'
import { kunFetchGet } from '~/utils/kunFetch'
import { refreshUserSession } from '~/utils/sessionClient'
import { createMessageSyncScheduler } from '~/utils/messageSync'
import { useMessageStore } from '~/store/messageStore'
import { useUserStore } from '~/store/userStore'
import type { Conversation } from '~/types/api/conversation'

interface Props {
  initialConversations: Conversation[]
  total: number
}
interface ConversationPage {
  conversations: Conversation[]
  total: number
}
const isConversationPage = (value: unknown): value is ConversationPage =>
  !!value &&
  typeof value === 'object' &&
  'conversations' in value &&
  Array.isArray(value.conversations) &&
  value.conversations.every(
    (conversation: unknown) =>
      !!conversation &&
      typeof conversation === 'object' &&
      'id' in conversation &&
      typeof conversation.id === 'number' &&
      'unreadCount' in conversation &&
      typeof conversation.unreadCount === 'number'
  ) &&
  'total' in value &&
  typeof value.total === 'number' &&
  Number.isFinite(value.total) &&
  value.total >= 0

export const ConversationList = ({ initialConversations, total }: Props) => {
  const [conversations, setConversations] = useState(initialConversations)
  const [loading, setLoading] = useState(false)
  const [syncFailed, setSyncFailed] = useState(false)
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(total)
  const pageRef = useRef(page)
  pageRef.current = page
  const previousPageRef = useRef(page)
  const isMounted = useMounted()
  const activity = useMessageSyncActivity()
  const { sessionStatus, sessionContext, sessionGeneration } = useUserStore()
  const schedulerRef = useRef<ReturnType<
    typeof createMessageSyncScheduler<ConversationPage>
  > | null>(null)
  const activityRef = useRef(activity)
  activityRef.current = activity

  useEffect(() => {
    if (!isMounted || !sessionContext) return
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
    const scheduler = createMessageSyncScheduler<ConversationPage>({
      intervalMs: 30_000,
      random: () => 0.5,
      validate: isConversationPage,
      request: (signal) =>
        kunFetchGet<ConversationPage>(
          '/message/conversation',
          { page: pageRef.current, limit: 30 },
          {
            timeout: 15_000,
            signal,
            preserveErrorStatus: true
          }
        ),
      onSuccess: (response) => {
        if (!isCurrent()) return
        setConversations(response.conversations)
        setTotalCount(response.total)
        if (
          response.conversations.some(
            (conversation) => conversation.unreadCount > 0
          )
        ) {
          useMessageStore.getState().setHasUnreadConversation(true)
        }
      },
      onInvalid: () => {
        if (isCurrent()) void refreshUserSession()
      },
      onChange: (snapshot) => {
        if (!isCurrent()) return
        if (snapshot.status !== 'syncing') setLoading(false)
        setSyncFailed(snapshot.status === 'error')
      }
    })
    schedulerRef.current = scheduler
    scheduler.setIdentity({ context, generation })
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
      scheduler.dispose()
      if (schedulerRef.current === scheduler) schedulerRef.current = null
    }
  }, [isMounted, sessionContext, sessionGeneration])

  useEffect(() => {
    const scheduler = schedulerRef.current
    if (!scheduler || page === previousPageRef.current) return
    previousPageRef.current = page
    scheduler.invalidatePending()
    setLoading(true)
    scheduler.refresh('manual')
  }, [page])

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

  return (
    <div className="space-y-4">
      {syncFailed && (
        <p role="status" className="text-sm text-default-500">
          会话同步暂时不可用，将自动重试
        </p>
      )}
      {loading ? (
        <KunLoading hint="正在获取会话列表..." />
      ) : conversations.length === 0 ? (
        <KunNull message="暂无私聊会话，您可以在其他用户的主页发起私聊" />
      ) : (
        <div className="space-y-3">
          {conversations.map((conv) => (
            <ConversationCard key={conv.id} conversation={conv} />
          ))}
        </div>
      )}

      {totalCount > 30 && (
        <div className="flex justify-center">
          <KunPagination
            total={Math.ceil(totalCount / 30)}
            page={page}
            onPageChange={setPage}
            isLoading={loading}
          />
        </div>
      )}
    </div>
  )
}
