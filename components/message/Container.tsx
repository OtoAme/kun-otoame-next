'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { Tab, Tabs } from '@heroui/tabs'
import {
  Bell,
  Heart,
  CircleHelp,
  FileCheck2,
  Globe,
  MessagesSquare,
  Rss,
  Wrench
} from 'lucide-react'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  useDisclosure
} from '@heroui/react'
import { KunLoading } from '~/components/kun/Loading'
import { KunNull } from '~/components/kun/Null'
import { KunPagination } from '~/components/kun/Pagination'
import { useSessionContentReady } from '~/components/kun/SessionContentBoundary'
import { MessageCard } from './MessageCard'
import { MessageNav } from './MessageNav'
import {
  KunFetchError,
  kunFetchDelete,
  kunFetchGet,
  kunFetchPut
} from '~/utils/kunFetch'
import { refreshUserSession } from '~/utils/sessionClient'
import { useUserStore } from '~/store/userStore'
import { useMessageStore } from '~/store/messageStore'
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABELS,
  NOTIFICATION_PAGE_SIZES,
  NOTIFICATION_DEFAULT_PAGE_SIZE,
  isNotificationSequence,
  type NotificationCategory
} from '~/constants/notification'
import { beginUnreadRead, seedSessionUnread } from '~/utils/messageSync'
import {
  confirmNotificationItems,
  isCurrentNotificationIdentity,
  notificationIdentityKey,
  type NotificationIdentity
} from '~/utils/notificationReading'
import {
  notificationView,
  invalidateNotificationViews,
  type NotificationView,
  type NotificationViewPage
} from '~/utils/notificationViewCache'
import type {
  Message,
  MessageUnreadStatus,
  NotificationReadAllResponse,
  NotificationList
} from '~/types/api/message'

type ReadingState = 'unread' | 'all' | 'read'
const categoryIcons = {
  '': Bell,
  mention: MessagesSquare,
  interaction: Heart,
  follow: Rss,
  help: CircleHelp,
  review: FileCheck2,
  maintenance: Wrench,
  account: Globe
}
interface Props {
  initialMessages?: Message[]
  total?: number
}

export const MessageContainer = (_props: Props) => {
  const contentReady = useSessionContentReady()
  const contentReadyRef = useRef(contentReady)
  contentReadyRef.current = contentReady
  const session = useUserStore()
  const summary = useMessageStore((state) => state.notifications)
  const hasUnread = useMessageStore((state) => state.hasUnreadNotification)
  const pathname = usePathname()
  const params = useSearchParams()
  const entryState = useRef<{ owner: string; state: ReadingState } | null>(null)
  const requestedCategory =
    params.get('category') ??
    ({
      '/message/follow': 'follow',
      '/message/mention': 'mention',
      '/message/system': 'account'
    }[pathname] ||
      null)
  const category = NOTIFICATION_CATEGORIES.includes(
    requestedCategory as NotificationCategory
  )
    ? (requestedCategory as NotificationCategory)
    : undefined
  const identity = useMemo<NotificationIdentity | null>(
    () =>
      session.sessionStatus === 'authenticated' && session.sessionContext
        ? {
            uid: session.user.uid,
            context: session.sessionContext,
            generation: session.sessionGeneration
          }
        : null,
    [
      session.sessionStatus,
      session.user.uid,
      session.sessionContext,
      session.sessionGeneration
    ]
  )
  const owner = identity ? notificationIdentityKey(identity) : null
  if (owner && entryState.current?.owner !== owner)
    entryState.current = { owner, state: hasUnread ? 'unread' : 'all' }
  const requestedState = params.get('state')
  const state: ReadingState =
    requestedState === 'unread' ||
    requestedState === 'all' ||
    requestedState === 'read'
      ? requestedState
      : entryState.current?.owner === owner
        ? entryState.current.state
        : 'all'
  const pageSize =
    NOTIFICATION_PAGE_SIZES.find(
      (size) => size === Number(params.get('limit'))
    ) ?? NOTIFICATION_DEFAULT_PAGE_SIZE
  const key = [category ?? '', state, pageSize].join(':')
  const [view, setView] = useState<NotificationView | null>(null)
  const viewRef = useRef<NotificationView | null>(null)
  const [, render] = useState(0)
  const [readingEpoch, restartReading] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [readErrors, setReadErrors] = useState<Record<number, string>>({})
  const [clearing, setClearing] = useState(false)
  const [markingAllOwner, setMarkingAllOwner] = useState<string | null>(null)
  const markingAll = owner !== null && markingAllOwner === owner
  const [bulkReadError, setBulkReadError] = useState<string | null>(null)
  const [viewEpoch, refreshViews] = useState(0)
  const request = useRef(0)
  const pending = useRef<{
    view: NotificationView
    index: number
    cursor?: number
    controller: AbortController
    promise: Promise<KunResponse<NotificationList>>
  } | null>(null)
  const attemptedPage = useRef<{ index: number; cursor?: number }>({ index: 0 })
  const queued = useRef(
    new Map<
      number,
      {
        message: Message
        page: NotificationViewPage
        view: NotificationView
        eligible?: () => boolean
      }
    >()
  )
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { isOpen, onOpen, onClose, onOpenChange } = useDisclosure()
  const cancelQueued = useCallback(() => {
    if (flushTimer.current) clearTimeout(flushTimer.current)
    flushTimer.current = null
    if (queued.current.size) restartReading((value) => value + 1)
    queued.current.clear()
  }, [])
  useEffect(() => {
    window.addEventListener('pagehide', cancelQueued)
    document.addEventListener('visibilitychange', cancelQueued)
    return () => {
      window.removeEventListener('pagehide', cancelQueued)
      document.removeEventListener('visibilitychange', cancelQueued)
    }
  }, [cancelQueued])
  useEffect(() => {
    if (!identity || pathname === '/message/notice') return
    const next = new URLSearchParams(params.toString())
    next.delete('type')
    next.set('state', state)
    if (category) next.set('category', category)
    else next.delete('category')
    window.history.replaceState(null, '', '/message/notice?' + next.toString())
  }, [identity, pathname, params, category, state])
  const current =
    view?.owner === owner && view.key === key && view === viewRef.current
      ? view.pages[view.index]
      : undefined
  const currentSequence = category
    ? summary?.categories[category]?.sequence
    : summary?.sequence
  const newContent =
    current &&
    currentSequence &&
    isNotificationSequence(currentSequence) &&
    BigInt(currentSequence) > BigInt(current.contentSequence)

  const fetchPage = useCallback(
    async (cache: NotificationView, index: number, cursor?: number) => {
      if (!identity || !isCurrentNotificationIdentity(identity)) return
      const token = ++request.current
      attemptedPage.current = { index, cursor }
      setLoading(true)
      setError(null)
      try {
        if (
          pending.current?.view !== cache ||
          pending.current.index !== index ||
          pending.current.cursor !== cursor
        ) {
          pending.current?.controller.abort()
          const controller = new AbortController()
          const first = cache.pages[0]
          pending.current = {
            view: cache,
            index,
            cursor,
            controller,
            promise: kunFetchGet<KunResponse<NotificationList>>(
              '/message/all',
              {
                ...(category ? { category } : {}),
                state,
                page: index + 1,
                limit: pageSize,
                ...(state === 'unread' && first
                  ? { upperId: first.upperId }
                  : {}),
                ...(state === 'unread' && cursor !== undefined
                  ? { cursor }
                  : {})
              },
              {
                timeout: 15_000,
                signal: controller.signal,
                headers: { 'X-Kun-Notification-Session': identity.context },
                preserveErrorStatus: true
              }
            )
          }
        }
        const response = await pending.current.promise
        if (
          token !== request.current ||
          !isCurrentNotificationIdentity(identity) ||
          viewRef.current !== cache
        )
          return
        if (
          !response ||
          typeof response === 'string' ||
          !Array.isArray(response.messages) ||
          !isNotificationSequence(response.contentSequence)
        )
          throw new Error(
            typeof response === 'string' ? response : '通知列表暂不可用'
          )
        cache.pages[index] = { ...response, cursor, justRead: [], scrollY: 0 }
        cache.index = index
        setView(cache)
        render((value) => value + 1)
      } catch (error) {
        if (
          error instanceof KunFetchError &&
          (error.status === 401 ||
            error.code === 'NOTIFICATION_CONTEXT_CHANGED') &&
          isCurrentNotificationIdentity(identity)
        )
          void refreshUserSession()
        if (
          token === request.current &&
          isCurrentNotificationIdentity(identity) &&
          viewRef.current === cache
        )
          setError('获取通知失败，请检查网络后重试')
      } finally {
        if (token === request.current) pending.current = null
        if (
          token === request.current &&
          isCurrentNotificationIdentity(identity)
        )
          setLoading(false)
      }
    },
    [identity, category, state, pageSize]
  )

  useEffect(() => {
    request.current++
    setError(null)
    setReadErrors({})
    setBulkReadError(null)
    if (!identity) {
      viewRef.current = null
      setView(null)
      setLoading(false)
      return
    }
    const cache = notificationView(identity, key)
    viewRef.current = cache
    setView(cache)
    if (!cache.pages.length) void fetchPage(cache, 0)
    else setLoading(false)
    return () => {
      request.current++
      if (flushTimer.current) clearTimeout(flushTimer.current)
      queued.current.clear()
      flushTimer.current = null
    }
  }, [identity, key, fetchPage, viewEpoch])

  useEffect(() => {
    if (!contentReady || !identity || !view || !current || loading) return
    const displayedView = view
    const displayedPage = current
    const location = window.location.pathname + window.location.search
    const active = () =>
      contentReadyRef.current &&
      isCurrentNotificationIdentity(identity) &&
      viewRef.current === displayedView &&
      displayedView.pages[displayedView.index] === displayedPage &&
      window.location.pathname + window.location.search === location
    const savePosition = () => {
      if (active()) displayedPage.scrollY = window.scrollY
    }
    const frame = requestAnimationFrame(() => {
      if (!active()) return
      window.scrollTo(0, displayedPage.scrollY)
      window.addEventListener('scroll', savePosition, { passive: true })
    })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', savePosition)
    }
  }, [contentReady, identity, view, current, loading])

  const seen = useCallback(
    (message: Message, eligible?: () => boolean, immediate = false) => {
      const cache = viewRef.current
      const page = cache?.pages[cache.index]
      if (
        !identity ||
        !isCurrentNotificationIdentity(identity) ||
        markingAll ||
        !cache ||
        !page ||
        document.visibilityState !== 'visible' ||
        message.status !== 0 ||
        !message.contentVersion
      )
        return
      queued.current.set(message.id, { message, page, view: cache, eligible })
      if (flushTimer.current && !immediate) return
      if (flushTimer.current) clearTimeout(flushTimer.current)
      const token = request.current
      const flush = () => {
        flushTimer.current = null
        const candidates = [...queued.current.values()]
        const entries = candidates.filter(
          ({ eligible }) => !eligible || eligible()
        )
        queued.current.clear()
        const activePage = () =>
          token === request.current &&
          viewRef.current === cache &&
          cache.pages[cache.index] === page
        if (
          !activePage() ||
          !isCurrentNotificationIdentity(identity) ||
          document.visibilityState !== 'visible'
        ) {
          restartReading((value) => value + 1)
          return
        }
        if (entries.length !== candidates.length)
          restartReading((value) => value + 1)
        if (!entries.length) return
        void confirmNotificationItems(
          identity,
          entries.map(({ message }) => ({
            id: message.id,
            version: message.contentVersion!
          }))
        )
          .then((results) => {
            if (!isCurrentNotificationIdentity(identity)) return
            const errors: Record<number, string> = {}
            for (const result of results) {
              const captured = entries.find(
                ({ message }) => message.id === result.id
              )
              if (!captured) continue
              if (
                result.outcome === 'read' ||
                result.outcome === 'already_read'
              ) {
                captured.page.messages = captured.page.messages.map((item) =>
                  item.id === result.id &&
                  item.contentVersion === captured.message.contentVersion
                    ? { ...item, status: 1 }
                    : item
                )
                if (!captured.page.justRead.includes(result.id))
                  captured.page.justRead.push(result.id)
              } else
                errors[result.id] =
                  result.outcome === 'changed'
                    ? '这条通知已有新动态，请刷新页面后阅读'
                    : '这条通知已不可用，请刷新页面'
            }
            if (activePage()) {
              setReadErrors((previous) => ({ ...previous, ...errors }))
              render((value) => value + 1)
            }
          })
          .catch(() => {
            if (isCurrentNotificationIdentity(identity) && activePage())
              setReadErrors((previous) => ({
                ...previous,
                ...Object.fromEntries(
                  entries.map(({ message }) => [
                    message.id,
                    '阅读确认失败，请刷新页面后重试'
                  ])
                )
              }))
          })
      }
      if (immediate) flush()
      else flushTimer.current = setTimeout(flush, 100)
    },
    [identity, readingEpoch, markingAll]
  )

  const reload = () => {
    if (!view || !identity) return
    cancelQueued()
    pending.current?.controller.abort()
    pending.current = null
    view.pages = []
    view.index = 0
    setReadErrors({})
    void fetchPage(view, 0)
  }
  const filter = (changes: {
    category?: string
    state?: ReadingState
    pageSize?: number
  }) => {
    if (!identity) return
    cancelQueued()
    const next = new URLSearchParams(params.toString())
    next.delete('type')
    next.set('state', changes.state ?? state)
    if (changes.category !== undefined) {
      if (changes.category) next.set('category', changes.category)
      else next.delete('category')
    } else if (category) next.set('category', category)
    const nextSize = changes.pageSize ?? pageSize
    if (nextSize === NOTIFICATION_DEFAULT_PAGE_SIZE) next.delete('limit')
    else next.set('limit', String(nextSize))
    const nextKey = [
      next.get('category') ?? '',
      next.get('state'),
      nextSize
    ].join(':')
    if (nextKey === key) return
    notificationView(identity, nextKey, true)
    window.history.pushState(null, '', '/message/notice?' + next.toString())
  }
  const turn = (index: number) => {
    if (!view || !current) return
    cancelQueued()
    current.scrollY = window.scrollY
    if (view.pages[index]) {
      request.current++
      setLoading(false)
      view.index = index
      render((value) => value + 1)
    } else
      void fetchPage(
        view,
        index,
        state === 'unread' ? (current.nextCursor ?? undefined) : undefined
      )
  }
  const clear = async () => {
    if (!identity || !isCurrentNotificationIdentity(identity) || clearing)
      return
    const readVersion = beginUnreadRead()
    setClearing(true)
    try {
      const response = await kunFetchDelete<
        KunResponse<{ deleted: number; summary: MessageUnreadStatus }>
      >(
        '/message/read',
        {
          ...(category ? { category } : {})
        },
        {
          timeout: 15_000,
          preserveErrorStatus: true,
          headers: { 'X-Kun-Notification-Session': identity.context }
        }
      )
      if (!isCurrentNotificationIdentity(identity) || viewRef.current !== view)
        return
      if (!response || typeof response === 'string' || !response.summary)
        throw new Error('clear failed')
      seedSessionUnread(identity, response.summary, readVersion)
      onClose()
      reload()
    } catch (error) {
      if (
        error instanceof KunFetchError &&
        (error.status === 401 ||
          error.code === 'NOTIFICATION_CONTEXT_CHANGED') &&
        isCurrentNotificationIdentity(identity)
      )
        void refreshUserSession()
      if (isCurrentNotificationIdentity(identity))
        setError('清理已读通知失败，请稍后重试')
    } finally {
      if (isCurrentNotificationIdentity(identity)) setClearing(false)
    }
  }

  const markAllRead = async () => {
    if (
      !identity ||
      !isCurrentNotificationIdentity(identity) ||
      markingAll ||
      !view
    )
      return
    const operationOwner = notificationIdentityKey(identity)
    const displayedView = view
    const readVersion = beginUnreadRead()
    cancelQueued()
    setMarkingAllOwner(operationOwner)
    setBulkReadError(null)
    try {
      const response = await kunFetchPut<
        KunResponse<NotificationReadAllResponse>
      >(
        '/message/read',
        { scope: category ?? 'all' },
        {
          timeout: 15_000,
          preserveErrorStatus: true,
          headers: { 'X-Kun-Notification-Session': identity.context }
        }
      )
      if (!isCurrentNotificationIdentity(identity)) return
      if (
        !response ||
        typeof response === 'string' ||
        !Number.isSafeInteger(response.read) ||
        response.read < 0 ||
        !response.summary
      )
        throw new Error('Notification bulk reading failed')
      seedSessionUnread(identity, response.summary, readVersion)
      invalidateNotificationViews(identity, category)
      const activeCategory = viewRef.current?.key.split(':')[0]
      if (!category || !activeCategory || activeCategory === category)
        refreshViews((value) => value + 1)
    } catch (error) {
      if (
        error instanceof KunFetchError &&
        (error.status === 401 ||
          error.code === 'NOTIFICATION_CONTEXT_CHANGED') &&
        isCurrentNotificationIdentity(identity)
      )
        void refreshUserSession()
      if (
        isCurrentNotificationIdentity(identity) &&
        viewRef.current === displayedView
      )
        setBulkReadError('标记已读失败，请再次点击“全部已读”重试')
    } finally {
      setMarkingAllOwner((currentOwner) =>
        currentOwner === operationOwner ? null : currentOwner
      )
    }
  }

  if (!identity)
    return (
      <>
        <MessageNav />
        <p role="status" className="w-full lg:w-3/4">
          {session.sessionStatus === 'checking'
            ? '正在确认登录状态…'
            : session.sessionStatus === 'unavailable'
              ? '登录状态暂不可用，恢复后继续查看通知'
              : '请登录后查看通知'}
        </p>
      </>
    )
  return (
    <>
      <MessageNav>
        <nav
          className="flex flex-row gap-2 overflow-x-auto lg:flex-col"
          aria-label="通知分类"
        >
          {(['', ...NOTIFICATION_CATEGORIES] as const).map((item) => {
            const Icon = categoryIcons[item]
            const label = item
              ? NOTIFICATION_CATEGORY_LABELS[item as NotificationCategory]
              : '全部分类'
            const unread = item
              ? summary?.categories[item as NotificationCategory]?.unread
              : summary?.unread
            return (
              <Button
                key={item}
                size="sm"
                className="justify-start w-full max-lg:w-auto max-lg:shrink-0"
                variant={(category ?? '') === item ? 'flat' : 'light'}
                color={(category ?? '') === item ? 'secondary' : 'default'}
                startContent={<Icon className="size-3.5 shrink-0" />}
                aria-pressed={(category ?? '') === item}
                aria-label={`${label}，${unread === undefined ? '未读数待获取' : `未读 ${unread} 条`}`}
                title={unread ? '未读通知数' : undefined}
                onPress={() => filter({ category: item })}
              >
                <span>{label}</span>
                {(unread ?? 0) > 0 && (
                  <span
                    className="shrink-0 tabular-nums lg:ml-auto"
                    aria-hidden="true"
                  >
                    {unread}
                  </span>
                )}
              </Button>
            )
          })}
        </nav>
      </MessageNav>
      <section
        className="w-full min-w-0 space-y-4 lg:w-3/4"
        aria-label="通知中心"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs
            aria-label="阅读状态"
            selectedKey={state}
            onSelectionChange={(key) => filter({ state: key as ReadingState })}
          >
            <Tab key="unread" title="未读" />
            <Tab key="all" title="全部" />
            <Tab key="read" title="已读" />
          </Tabs>
          {state === 'read' && (
            <Button
              size="sm"
              variant="flat"
              color="danger"
              className="ml-auto"
              isDisabled={loading || clearing}
              onPress={onOpen}
            >
              {category ? '清理已读' : '清理全部已读'}
            </Button>
          )}
          {state !== 'read' && (
            <Button
              size="sm"
              variant="flat"
              color="primary"
              className="ml-auto"
              isDisabled={
                loading ||
                markingAll ||
                !current ||
                (category
                  ? summary?.categories[category].unread
                  : summary?.unread) === 0
              }
              isLoading={markingAll}
              onPress={markAllRead}
            >
              全部已读
            </Button>
          )}
        </div>
        {bulkReadError && (
          <p role="alert" className="text-sm text-danger">
            {bulkReadError}
          </p>
        )}
        {newContent && (
          <div role="status">
            <Button color="primary" variant="flat" onPress={reload}>
              有新通知／有新动态，点击查看
            </Button>
          </div>
        )}
        {error && (
          <div role="alert" className="space-y-2">
            <p>{error}</p>
            <Button
              size="sm"
              onPress={() => {
                if (view)
                  void fetchPage(
                    view,
                    attemptedPage.current.index,
                    attemptedPage.current.cursor
                  )
              }}
            >
              重试
            </Button>
          </div>
        )}
        {loading ? (
          <KunLoading hint="正在获取通知…" />
        ) : current?.messages.length ? (
          <div className="space-y-4">
            {current.messages.map((message) => (
              <MessageCard
                key={message.id + ':' + message.contentVersion}
                msg={message}
                showCategory={!category}
                identity={identity}
                onSeen={seen}
                justRead={current.justRead.includes(message.id)}
                confirmationError={readErrors[message.id]}
              />
            ))}
          </div>
        ) : (
          !error && (
            <div role="status" className="flex flex-col items-center gap-4">
              <KunNull
                message={state === 'unread' ? '暂无未读消息' : '暂无消息'}
              />
              {state === 'unread' && (
                <Button variant="flat" onPress={() => filter({ state: 'all' })}>
                  查看全部通知
                </Button>
              )}
            </div>
          )
        )}
        {current && (current.messages.length > 0 || (view?.index ?? 0) > 0) && (
          <div className="grid w-full grid-cols-1 items-center gap-3 sm:grid-cols-[8rem_1fr_8rem]">
            <Select
              aria-label="每页通知数量"
              size="sm"
              className="w-32 justify-self-start"
              selectedKeys={[String(pageSize)]}
              disallowEmptySelection
              isDisabled={loading || markingAll}
              onSelectionChange={(keys) => {
                const size = Number(Array.from(keys)[0])
                if (NOTIFICATION_PAGE_SIZES.some((option) => option === size))
                  filter({ pageSize: size })
              }}
            >
              {NOTIFICATION_PAGE_SIZES.map((size) => (
                <SelectItem key={String(size)} textValue={`${size} 条 / 页`}>
                  {`${size} 条 / 页`}
                </SelectItem>
              ))}
            </Select>
            {current &&
              state === 'unread' &&
              (view!.index > 0 || current.nextCursor) && (
                <div className="flex items-center justify-center gap-4 sm:col-start-2">
                  <Button
                    isDisabled={loading || !view || view.index === 0}
                    onPress={() => turn(view!.index - 1)}
                  >
                    上一页
                  </Button>
                  <span>第 {(view?.index ?? 0) + 1} 页</span>
                  <Button
                    isDisabled={loading || !current.nextCursor}
                    onPress={() => turn(view!.index + 1)}
                  >
                    下一页
                  </Button>
                </div>
              )}
            {current && state !== 'unread' && current.total > pageSize && (
              <div className="flex justify-center sm:col-start-2">
                <KunPagination
                  page={(view?.index ?? 0) + 1}
                  total={Math.ceil(current.total / pageSize)}
                  onPageChange={(page) => turn(page - 1)}
                  isLoading={loading}
                />
              </div>
            )}
          </div>
        )}
        <Modal isOpen={isOpen} onOpenChange={onOpenChange} placement="center">
          <ModalContent>
            <ModalHeader>清理已读通知</ModalHeader>
            <ModalBody>
              <p>
                确认清理
                {category ? NOTIFICATION_CATEGORY_LABELS[category] : '全部分类'}
                中已读的通知？未读通知会保留。
              </p>
            </ModalBody>
            <ModalFooter>
              <Button variant="light" isDisabled={clearing} onPress={onClose}>
                取消
              </Button>
              <Button color="danger" isLoading={clearing} onPress={clear}>
                确认清理
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </section>
    </>
  )
}
