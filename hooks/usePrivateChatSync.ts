'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSessionContentReady } from '~/components/kun/SessionContentBoundary'
import { useUserStore } from '~/store/userStore'
import { useMessageStore } from '~/store/messageStore'
import { kunFetchGet, kunFetchPut, KunFetchError } from '~/utils/kunFetch'
import {
  beginUnreadRead,
  createMessageSyncScheduler,
  seedSessionUnread
} from '~/utils/messageSync'
import { refreshUserSession } from '~/utils/sessionClient'
import { getChatSyncInterval } from '~/utils/privateChatSync'
import { useMessageSyncActivity } from './useMessageSyncActivity'
import type {
  ConversationMessagesResponse,
  ConversationReadResponse
} from '~/types/api/conversation'

type Direction = 'new' | 'history'
type Batch = {
  response: ConversationMessagesResponse
  direction: Direction
  reviewIds: number[]
}
type HistoryRequest = {
  beforeId: number
  resolve: (response: ConversationMessagesResponse | null) => void
}
interface Options {
  conversationId: number
  initialSessionContext: string
  initialCursor: number
  getReviewIds: () => number[]
  onBatch: (
    response: ConversationMessagesResponse,
    direction: Direction
  ) => void
}

const isMessagePage = (
  value: unknown
): value is ConversationMessagesResponse => {
  if (!value || typeof value !== 'object') return false
  const page = value as ConversationMessagesResponse
  if (
    !Array.isArray(page.messages) ||
    page.messages.length > 50 ||
    !Array.isArray(page.reviewMessages) ||
    page.reviewMessages.length > 100 ||
    !Array.isArray(page.unavailableIds) ||
    typeof page.hasMoreAfter !== 'boolean' ||
    typeof page.hasMoreBefore !== 'boolean'
  )
    return false
  const ids = page.messages.map((message) => message.id)
  return (
    ids.every(
      (id, index) =>
        Number.isSafeInteger(id) &&
        id > 0 &&
        (index === 0 || id > ids[index - 1])
    ) &&
    page.oldestId === (ids[0] ?? null) &&
    page.latestId === (ids.at(-1) ?? null) &&
    (!page.hasMoreAfter || ids.length > 0)
  )
}

export const usePrivateChatSync = (options: Options) => {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const contentReady = useSessionContentReady()
  const contentReadyRef = useRef(contentReady)
  contentReadyRef.current = contentReady
  const activity = useMessageSyncActivity(true)
  const activityRef = useRef(activity)
  activityRef.current = activity
  const { sessionStatus, sessionContext, sessionGeneration } = useUserStore()
  const [syncFailed, setSyncFailed] = useState(false)
  const [readFailed, setReadFailed] = useState(false)
  const syncRef = useRef<ReturnType<
    typeof createMessageSyncScheduler<Batch>
  > | null>(null)
  const readSyncRef = useRef<ReturnType<
    typeof createMessageSyncScheduler<ConversationReadResponse>
  > | null>(null)
  const historyRef = useRef<HistoryRequest | null>(null)
  const quietSinceRef = useRef(Date.now())
  const reviewChangedRef = useRef(false)
  const reviewSignatureRef = useRef('')
  const readNeededRef = useRef(true)

  const recordActivity = useCallback(() => {
    if (!contentReadyRef.current || document.visibilityState === 'hidden')
      return
    const wasSlow = Date.now() - quietSinceRef.current >= 60_000
    quietSinceRef.current = Date.now()
    if (wasSlow) syncRef.current?.refresh('manual')
  }, [])
  const requestReview = useCallback(() => {
    recordActivity()
    const signature = optionsRef.current.getReviewIds().join(',')
    if (signature === reviewSignatureRef.current) return
    reviewSignatureRef.current = signature
    reviewChangedRef.current = true
    syncRef.current?.refresh('manual')
  }, [recordActivity])
  const loadHistory = useCallback((beforeId: number) => {
    if (
      !syncRef.current ||
      historyRef.current ||
      !activityRef.current.enabled ||
      !contentReadyRef.current ||
      useUserStore.getState().sessionStatus !== 'authenticated'
    )
      return Promise.resolve(null)
    return new Promise<ConversationMessagesResponse | null>((resolve) => {
      historyRef.current = { beforeId, resolve }
      syncRef.current!.refresh('manual')
    })
  }, [])

  useEffect(() => {
    if (!sessionContext || sessionContext !== options.initialSessionContext)
      return
    let disposed = false
    setSyncFailed(false)
    setReadFailed(false)
    const context = sessionContext
    const generation = sessionGeneration
    const conversationId = options.conversationId
    let cursor = options.initialCursor
    let confirmedThroughId = 0
    let readDesiredId = 0
    let openedConfirmed = false
    let readVersion = 0
    let reviewQueue: number[] = []
    let hasMoreNew = false
    let continuationProgress = false
    quietSinceRef.current = Date.now()
    readNeededRef.current = true
    const currentIdentity = () => {
      const state = useUserStore.getState()
      return (
        !disposed &&
        state.sessionStatus === 'authenticated' &&
        state.sessionContext === context &&
        state.sessionGeneration === generation &&
        optionsRef.current.conversationId === conversationId &&
        optionsRef.current.initialSessionContext === context
      )
    }
    const foreground = () =>
      currentIdentity() &&
      contentReadyRef.current &&
      activityRef.current.enabled &&
      document.visibilityState !== 'hidden' &&
      navigator.onLine !== false
    const invalid = () => {
      if (currentIdentity()) void refreshUserSession()
    }
    const readScheduler = createMessageSyncScheduler<ConversationReadResponse>({
      request: async (signal) => {
        if (!foreground()) throw new KunFetchError('Chat paused', 'aborted')
        readVersion = beginUnreadRead()
        const response = await kunFetchPut<ConversationReadResponse>(
          `/message/conversation/${conversationId}/read`,
          undefined,
          {
            timeout: 15_000,
            signal,
            preserveErrorStatus: true
          }
        )
        if (
          !response ||
          typeof response.hasUnreadNotification !== 'boolean' ||
          typeof response.hasUnreadConversation !== 'boolean' ||
          !Number.isSafeInteger(response.readThroughId)
        ) {
          throw new KunFetchError('Invalid chat read response', 'http', 200)
        }
        return response
      },
      onSuccess: (response) => {
        if (!foreground()) return
        if (seedSessionUnread({ context, generation }, response, readVersion)) {
          useMessageStore.getState().setUnreadMessageStatus({
            hasUnreadNotification: response.hasUnreadNotification,
            hasUnreadConversation: response.hasUnreadConversation
          })
        }
        setReadFailed(false)
        confirmedThroughId = Math.max(
          confirmedThroughId,
          response.readThroughId
        )
        openedConfirmed = true
        readNeededRef.current = readDesiredId > confirmedThroughId
        if (!readNeededRef.current) readScheduler.setEnabled(false)
      },
      nextIntervalMs: () => 100,
      onInvalid: invalid,
      onChange: (snapshot) => {
        if (currentIdentity() && snapshot.status === 'error')
          setReadFailed(true)
      }
    })
    readSyncRef.current = readScheduler
    readScheduler.setIdentity({ context, generation })
    const scheduler = createMessageSyncScheduler<Batch>({
      request: async (signal) => {
        if (!foreground()) throw new KunFetchError('Chat paused', 'aborted')
        const history = historyRef.current
        const direction: Direction = history ? 'history' : 'new'
        const desired = optionsRef.current.getReviewIds()
        if (!history) {
          reviewSignatureRef.current = desired.join(',')
          const desiredSet = new Set(desired)
          reviewQueue = reviewQueue.filter((id) => desiredSet.has(id))
          if (!reviewQueue.length || reviewChangedRef.current) {
            reviewQueue = [...new Set([...desired, ...reviewQueue])]
            reviewChangedRef.current = false
          }
        }
        const reviewIds = history ? [] : reviewQueue.slice(0, 100)
        const query: Record<string, string | number> = { page: 1, limit: 50 }
        if (history) query.beforeId = history.beforeId
        else {
          query.afterId = cursor
          if (reviewIds.length) query.reviewIds = reviewIds.join(',')
        }
        try {
          const response = await kunFetchGet<ConversationMessagesResponse>(
            `/message/conversation/${conversationId}`,
            query,
            {
              timeout: 15_000,
              signal,
              preserveErrorStatus: true
            }
          )
          if (
            !isMessagePage(response) ||
            (direction === 'new' &&
              response.messages.some((message) => message.id <= cursor))
          ) {
            throw new KunFetchError(
              'Invalid chat message response',
              'http',
              200
            )
          }
          return { response, direction, reviewIds }
        } catch (error) {
          if (history && historyRef.current === history) {
            historyRef.current = null
            history.resolve(null)
          }
          throw error
        }
      },
      onSuccess: ({ response, direction, reviewIds }) => {
        if (!foreground()) return
        optionsRef.current.onBatch(response, direction)
        continuationProgress = false
        if (direction === 'new') {
          const previousCursor = cursor
          cursor = response.latestId ?? cursor
          hasMoreNew = response.hasMoreAfter && cursor > previousCursor
          const reviewed = new Set(reviewIds)
          reviewQueue = reviewQueue.filter((id) => !reviewed.has(id))
          continuationProgress = cursor > previousCursor || reviewIds.length > 0
          if (response.messages.length) quietSinceRef.current = Date.now()
          for (const message of response.messages) {
            if (
              message.sender.id !== useUserStore.getState().user.uid &&
              message.status === 0
            ) {
              readDesiredId = Math.max(readDesiredId, message.id)
            }
          }
          readNeededRef.current =
            !openedConfirmed || readDesiredId > confirmedThroughId
          readScheduler.setEnabled(foreground() && readNeededRef.current)
        } else {
          const history = historyRef.current
          historyRef.current = null
          history?.resolve(response)
        }
        setSyncFailed(false)
      },
      nextIntervalMs: () =>
        historyRef.current ||
        reviewChangedRef.current ||
        (continuationProgress && (hasMoreNew || reviewQueue.length > 0))
          ? 100
          : getChatSyncInterval(quietSinceRef.current),
      onInvalid: invalid,
      onChange: (snapshot) => {
        if (currentIdentity() && snapshot.status === 'error')
          setSyncFailed(true)
      }
    })
    syncRef.current = scheduler
    scheduler.setIdentity({ context, generation })
    const updateEnabled = () => {
      const enabled = foreground()
      scheduler.setEnabled(enabled)
      readScheduler.setEnabled(enabled && readNeededRef.current)
      if (!enabled && historyRef.current) {
        historyRef.current.resolve(null)
        historyRef.current = null
      }
    }
    const unsubscribe = useUserStore.subscribe(() => {
      if (currentIdentity()) {
        scheduler.confirmIdentity()
        readScheduler.confirmIdentity()
      }
      updateEnabled()
    })
    updateEnabled()
    return () => {
      disposed = true
      unsubscribe()
      scheduler.dispose()
      readScheduler.dispose()
      historyRef.current?.resolve(null)
      historyRef.current = null
      if (syncRef.current === scheduler) syncRef.current = null
      if (readSyncRef.current === readScheduler) readSyncRef.current = null
    }
  }, [
    options.conversationId,
    options.initialSessionContext,
    sessionContext,
    sessionGeneration
  ])

  useEffect(() => {
    const enabled =
      contentReady &&
      activity.enabled &&
      sessionStatus === 'authenticated' &&
      sessionContext === options.initialSessionContext
    syncRef.current?.setEnabled(enabled)
    readSyncRef.current?.setEnabled(enabled && readNeededRef.current)
    if (!enabled && historyRef.current) {
      historyRef.current.resolve(null)
      historyRef.current = null
    }
    if (enabled && activity.resumeVersion > 0) {
      quietSinceRef.current = Date.now()
      syncRef.current?.refresh('resume')
      readSyncRef.current?.refresh('resume')
    }
  }, [
    activity.enabled,
    activity.resumeVersion,
    contentReady,
    sessionStatus,
    sessionContext,
    options.initialSessionContext
  ])

  useEffect(() => {
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const
    const onActivity = () => recordActivity()
    events.forEach((event) =>
      window.addEventListener(event, onActivity, {
        passive: true,
        capture: true
      })
    )
    return () =>
      events.forEach((event) =>
        window.removeEventListener(event, onActivity, true)
      )
  }, [recordActivity])

  return {
    failed: syncFailed || readFailed,
    recordActivity,
    requestReview,
    loadHistory
  }
}
