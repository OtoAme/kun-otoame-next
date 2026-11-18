'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  useDisclosure
} from '@heroui/react'
import { KunLoading } from '~/components/kun/Loading'
import { KunPagination } from '~/components/kun/Pagination'
import { MessageCard } from './MessageCard'
import { kunFetchDelete, kunFetchGet } from '~/utils/kunFetch'
import { useUserStore } from '~/store/userStore'
import { useMessageStore } from '~/store/messageStore'
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABELS,
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
  type NotificationView,
  type NotificationViewPage
} from '~/utils/notificationViewCache'
import type {
  Message,
  MessageUnreadStatus,
  NotificationList
} from '~/types/api/message'
import type { MESSAGE_TYPE } from '~/constants/message'

type ReadingState = 'unread' | 'all' | 'read'
interface Props {
  initialMessages?: Message[]
  total?: number
  type?: (typeof MESSAGE_TYPE)[number]
}

export const MessageContainer = ({ type }: Props) => {
  const session = useUserStore()
  const summary = useMessageStore((state) => state.notifications)
  const hasUnread = useMessageStore((state) => state.hasUnreadNotification)
  const pathname = usePathname()
  const params = useSearchParams()
  const router = useRouter()
  const entryState = useRef<{ owner: string; state: ReadingState } | null>(null)
  const requestedCategory = params.get('category')
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
  const key = [pathname, type ?? '', category ?? '', state].join(':')
  const [view, setView] = useState<NotificationView | null>(null)
  const viewRef = useRef<NotificationView | null>(null)
  const [, render] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [readErrors, setReadErrors] = useState<Record<number, string>>({})
  const [clearing, setClearing] = useState(false)
  const request = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const attemptedPage = useRef<{ index: number; cursor?: number }>({ index: 0 })
  const queued = useRef(
    new Map<
      number,
      { message: Message; page: NotificationViewPage; view: NotificationView }
    >()
  )
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { isOpen, onOpen, onClose, onOpenChange } = useDisclosure()
  const current =
    view?.owner === owner && view.key === key && view === viewRef.current
      ? view.pages[view.index]
      : undefined
  const currentSequence = category
    ? summary?.categories[category].sequence
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
      controller.current?.abort()
      const activeController = new AbortController()
      controller.current = activeController
      setLoading(true)
      setError(null)
      try {
        const first = cache.pages[0]
        const response = await kunFetchGet<KunResponse<NotificationList>>(
          '/message/all',
          {
            ...(type ? { type } : {}),
            ...(category ? { category } : {}),
            state,
            page: index + 1,
            limit: 30,
            ...(state === 'unread' && first ? { upperId: first.upperId } : {}),
            ...(state === 'unread' && cursor !== undefined ? { cursor } : {})
          },
          {
            timeout: 15_000,
            signal: activeController.signal,
            preserveErrorStatus: true
          }
        )
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
      } catch {
        if (
          token === request.current &&
          isCurrentNotificationIdentity(identity) &&
          viewRef.current === cache
        )
          setError('获取通知失败，请检查网络后重试')
      } finally {
        if (
          token === request.current &&
          isCurrentNotificationIdentity(identity)
        )
          setLoading(false)
      }
    },
    [identity, type, category, state]
  )

  useEffect(() => {
    request.current++
    controller.current?.abort()
    setError(null)
    setReadErrors({})
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
    else {
      setLoading(false)
      requestAnimationFrame(() =>
        window.scrollTo(0, cache.pages[cache.index].scrollY)
      )
    }
    const savePosition = () => {
      if (cache.pages[cache.index])
        cache.pages[cache.index].scrollY = window.scrollY
    }
    window.addEventListener('scroll', savePosition, { passive: true })
    return () => {
      savePosition()
      window.removeEventListener('scroll', savePosition)
      request.current++
      controller.current?.abort()
      if (flushTimer.current) clearTimeout(flushTimer.current)
      queued.current.clear()
      flushTimer.current = null
    }
  }, [identity, key, fetchPage])

  const seen = useCallback(
    (message: Message) => {
      const cache = viewRef.current
      const page = cache?.pages[cache.index]
      if (
        !identity ||
        !isCurrentNotificationIdentity(identity) ||
        !cache ||
        !page ||
        message.status !== 0 ||
        !message.contentVersion
      )
        return
      queued.current.set(message.id, { message, page, view: cache })
      if (flushTimer.current) return
      flushTimer.current = setTimeout(() => {
        flushTimer.current = null
        const entries = [...queued.current.values()]
        queued.current.clear()
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
                    ? '这条通知已有新动态，请重新加载后阅读'
                    : '这条通知已不可用，请重新加载'
            }
            if (viewRef.current === cache) {
              setReadErrors((previous) => ({ ...previous, ...errors }))
              render((value) => value + 1)
            }
          })
          .catch(() => {
            if (
              isCurrentNotificationIdentity(identity) &&
              viewRef.current === cache
            )
              setReadErrors((previous) => ({
                ...previous,
                ...Object.fromEntries(
                  entries.map(({ message }) => [
                    message.id,
                    '阅读确认失败，请重新加载后重试'
                  ])
                )
              }))
          })
      }, 100)
    },
    [identity]
  )

  const reload = () => {
    if (!view || !identity) return
    view.pages = []
    view.index = 0
    setReadErrors({})
    void fetchPage(view, 0)
  }
  const filter = (changes: { category?: string; state?: ReadingState }) => {
    const next = new URLSearchParams(params.toString())
    next.set('state', changes.state ?? state)
    if (changes.category !== undefined) {
      if (changes.category) next.set('category', changes.category)
      else next.delete('category')
    }
    router.replace(pathname + '?' + next.toString(), { scroll: false })
  }
  const turn = (index: number) => {
    if (!view || !current) return
    current.scrollY = window.scrollY
    if (view.pages[index]) {
      request.current++
      controller.current?.abort()
      setLoading(false)
      view.index = index
      render((value) => value + 1)
      requestAnimationFrame(() => window.scrollTo(0, view.pages[index].scrollY))
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
          ...(type ? { type } : {}),
          ...(category ? { category } : {})
        },
        { timeout: 15_000, preserveErrorStatus: true }
      )
      if (!isCurrentNotificationIdentity(identity) || viewRef.current !== view)
        return
      if (!response || typeof response === 'string' || !response.summary)
        throw new Error('clear failed')
      seedSessionUnread(identity, response.summary, readVersion)
      onClose()
      reload()
    } catch {
      if (isCurrentNotificationIdentity(identity))
        setError('清理已读通知失败，请稍后重试')
    } finally {
      if (isCurrentNotificationIdentity(identity)) setClearing(false)
    }
  }

  if (!identity)
    return (
      <p role="status">
        {session.sessionStatus === 'checking'
          ? '正在确认登录状态…'
          : '请登录后查看通知'}
      </p>
    )
  return (
    <section className="space-y-4" aria-label="通知中心">
      <div className="flex gap-2 overflow-x-auto pb-2" aria-label="通知分类">
        {['', ...NOTIFICATION_CATEGORIES].map((item) => (
          <Button
            key={item}
            size="sm"
            className="shrink-0"
            variant={(category ?? '') === item ? 'solid' : 'flat'}
            color={(category ?? '') === item ? 'primary' : 'default'}
            aria-pressed={(category ?? '') === item}
            onPress={() => filter({ category: item })}
          >
            {item
              ? NOTIFICATION_CATEGORY_LABELS[item as NotificationCategory]
              : '全部分类'}{' '}
            ·{' '}
            {item
              ? (summary?.categories[item as NotificationCategory].unread ??
                '—')
              : (summary?.unread ?? '—')}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2" aria-label="阅读状态">
          {(['unread', 'all', 'read'] as const).map((item) => (
            <Button
              key={item}
              size="sm"
              aria-pressed={state === item}
              variant={state === item ? 'solid' : 'flat'}
              onPress={() => filter({ state: item })}
            >
              {{ unread: '未读', all: '全部', read: '已读' }[item]}
            </Button>
          ))}
        </div>
        {state === 'read' && (
          <Button
            size="sm"
            variant="light"
            color="danger"
            isDisabled={loading || clearing}
            onPress={onOpen}
          >
            清理当前分类已读
          </Button>
        )}
        <Button size="sm" variant="light" isDisabled={loading} onPress={reload}>
          重新加载
        </Button>
      </div>
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
              identity={identity}
              onSeen={seen}
              justRead={current.justRead.includes(message.id)}
              confirmationError={readErrors[message.id]}
            />
          ))}
        </div>
      ) : (
        !error && (
          <div role="status" className="space-y-3">
            <p>{state === 'unread' ? '没有未读通知' : '暂无通知'}</p>
            {state === 'unread' && (
              <Button variant="flat" onPress={() => filter({ state: 'all' })}>
                查看全部通知
              </Button>
            )}
          </div>
        )
      )}
      {current && state === 'unread' && (
        <div className="flex items-center justify-center gap-4">
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
      {current && state !== 'unread' && current.total > 30 && (
        <KunPagination
          page={(view?.index ?? 0) + 1}
          total={Math.ceil(current.total / 30)}
          onPageChange={(page) => turn(page - 1)}
          isLoading={loading}
        />
      )}
      <Modal isOpen={isOpen} onOpenChange={onOpenChange} placement="center">
        <ModalContent>
          <ModalHeader>清理已读通知</ModalHeader>
          <ModalBody>
            <p>
              确认清理
              {category ? NOTIFICATION_CATEGORY_LABELS[category] : '全部分类'}
              中仍为已读的通知？未读通知会保留。
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
  )
}
