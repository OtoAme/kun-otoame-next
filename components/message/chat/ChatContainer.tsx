'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { Card, CardBody, CardHeader } from '@heroui/card'
import { Button } from '@heroui/react'
import { ArrowLeft, ChevronDown, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { KunNull } from '~/components/kun/Null'
import { ChatMessage, type ChatReplyHighlight } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { DeleteConversationButton } from './DeleteConversationButton'
import { KunAvatar } from '~/components/kun/floating-card/KunAvatar'
import { KunControlledImageViewer } from '~/components/kun/image-viewer/ImageViewer'
import { kunFetchGet, kunFetchPut } from '~/utils/kunFetch'
import { useUserStore } from '~/store/userStore'
import { useMessageStore } from '~/store/messageStore'
import { cn } from '~/utils/cn'
import toast from 'react-hot-toast'
import type {
  ConversationMessagesResponse,
  PrivateMessage,
  PrivateMessageReplyPreview
} from '~/types/api/conversation'
import type { MessageUnreadStatus } from '~/types/api/message'
import type { KunImageViewerImage } from '~/components/kun/image-viewer/slides'

type MessageUpdateData =
  | { action: 'delete' }
  | { action: 'edit'; content: string; editedAt: string | Date }

interface ChatConversationImage extends KunImageViewerImage {
  messageId: number
  imageIndex: number
}

interface Props {
  conversationId: number
  initialMessages: PrivateMessage[]
  total: number
  hasMoreBefore?: boolean
  otherUser: KunUser
  className?: string
}

const sortMessagesByTime = (msgs: PrivateMessage[]) => {
  return [...msgs].sort(
    (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime()
  )
}

const CHAT_VISIBLE_POLL_INTERVAL_MS = 2_000
const CHAT_HIDDEN_POLL_INTERVAL_MS = 15_000
const CHAT_REPLY_SCROLL_DURATION_MS = 420
const CHAT_REPLY_HIGHLIGHT_DELAY_MS = 500
const CHAT_REPLY_HIGHLIGHT_VISIBLE_MS = 1_200
const CHAT_REPLY_HIGHLIGHT_FADE_MS = 260
const CHAT_LIVE_EDGE_THRESHOLD_PX = 96
const CHAT_SCROLL_BUTTON_FADE_MS = 180
const CHAT_SCROLL_BUTTON_POSITION_CLASSNAME =
  'pointer-events-none absolute bottom-28 right-8 z-20'
type ScrollButtonVisibilityMode = 'sync' | 'user-scroll' | 'programmatic-away'

const getMaxScrollTop = (container: HTMLElement) =>
  Math.max(0, container.scrollHeight - container.clientHeight)

const shouldReduceScrollMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const getLatestMessageId = (msgs: PrivateMessage[]) =>
  msgs.reduce((latest, msg) => Math.max(latest, msg.id), 0)

const getNextMessageId = (msgs: PrivateMessage[]) =>
  getLatestMessageId(msgs) + 1

const getOldestMessageId = (msgs: PrivateMessage[]) =>
  msgs.reduce(
    (oldest, msg) => Math.min(oldest, msg.id),
    Number.POSITIVE_INFINITY
  )

const mergeMessagesById = (
  currentMessages: PrivateMessage[],
  newMessages: PrivateMessage[]
) => {
  const messageMap = new Map<number, PrivateMessage>()

  for (const msg of currentMessages) {
    messageMap.set(msg.id, msg)
  }
  for (const msg of newMessages) {
    messageMap.set(msg.id, msg)
  }

  return sortMessagesByTime([...messageMap.values()])
}

const getMessageImages = (message: PrivateMessage) =>
  message.images && message.images.length > 0
    ? message.images
    : message.image
      ? [message.image]
      : []

const getReplyHighlight = (
  replyTo: PrivateMessageReplyPreview
): ChatReplyHighlight => {
  if (replyTo.image) {
    return {
      messageId: replyTo.messageId,
      kind: 'image',
      image: replyTo.image
    }
  }

  const selectedText = replyTo.selectedText?.trim()
  if (selectedText && selectedText !== replyTo.content.trim()) {
    return {
      messageId: replyTo.messageId,
      kind: 'text',
      selectedText: replyTo.selectedText ?? selectedText
    }
  }

  return {
    messageId: replyTo.messageId,
    kind: 'bubble'
  }
}

export const ChatContainer = ({
  conversationId,
  initialMessages,
  total,
  hasMoreBefore,
  otherUser,
  className
}: Props) => {
  const [messages, setMessages] = useState<PrivateMessage[]>(
    sortMessagesByTime(initialMessages)
  )
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(
    hasMoreBefore ?? initialMessages.length < total
  )
  const [totalCount, setTotalCount] = useState(total)
  const [replyDraft, setReplyDraft] = useState<{
    message: PrivateMessage
    selectedText: string | null
    imageIndex?: number | null
  } | null>(null)
  const [replyHighlight, setReplyHighlight] =
    useState<ChatReplyHighlight | null>(null)
  const [isReplyHighlightFading, setIsReplyHighlightFading] = useState(false)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const [isScrollButtonMounted, setIsScrollButtonMounted] = useState(false)
  const [replyJumpReturnPoint, setReplyJumpReturnPointState] = useState<
    number | null
  >(null)
  const [imageViewerIndex, setImageViewerIndex] = useState(-1)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const user = useUserStore((state) => state.user)
  const setUnreadMessageStatus = useMessageStore(
    (state) => state.setUnreadMessageStatus
  )
  const isInitialMount = useRef(true)
  const messagesRef = useRef(messages)
  const realtimeCursorRef = useRef(getLatestMessageId(initialMessages))
  const realtimePollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  const historyLoadInFlightRef = useRef(false)
  const replyHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  const replyScrollAnimationRef = useRef<number | null>(null)
  const scrollButtonUnmountTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null)
  const showScrollButtonRef = useRef(false)
  const lastScrollTopRef = useRef<number | null>(null)
  const replyJumpReturnPointRef = useRef<number | null>(null)
  const replyJumpReturnMessageIdRef = useRef<number | null>(null)
  const preserveReplyJumpReturnPointRef = useRef(false)
  const deferScrollButtonVisibilityRef = useRef(false)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    if (!replyDraft) {
      return
    }

    const replyTarget = messages.find((msg) => msg.id === replyDraft.message.id)
    if (!replyTarget || replyTarget.isDeleted) {
      setReplyDraft(null)
    }
  }, [messages, replyDraft])

  const conversationImages = useMemo<ChatConversationImage[]>(
    () =>
      messages.flatMap((message) => {
        if (message.isDeleted) {
          return []
        }

        return getMessageImages(message).map((image, imageIndex) => ({
          src: image.url,
          alt: image.name || message.content || '聊天图片',
          width: image.width,
          height: image.height,
          messageId: message.id,
          imageIndex
        }))
      }),
    [messages]
  )

  useEffect(() => {
    if (
      imageViewerIndex >= conversationImages.length ||
      conversationImages.length === 0
    ) {
      setImageViewerIndex(-1)
    }
  }, [conversationImages.length, imageViewerIndex])

  const isNearLiveEdge = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) {
      return true
    }

    const distanceFromBottom =
      container.scrollHeight - container.clientHeight - container.scrollTop
    return distanceFromBottom <= CHAT_LIVE_EDGE_THRESHOLD_PX
  }, [])

  const setReplyJumpReturnPoint = useCallback(
    (value: number | null, sourceMessageId: number | null = null) => {
      replyJumpReturnPointRef.current = value
      replyJumpReturnMessageIdRef.current =
        value === null ? null : sourceMessageId
      setReplyJumpReturnPointState(value)
    },
    []
  )

  const updateScrollButtonVisibility = useCallback(
    (mode: ScrollButtonVisibilityMode = 'sync') => {
      const container = scrollContainerRef.current
      if (!container) {
        return
      }

      const currentScrollTop = container.scrollTop
      const previousScrollTop = lastScrollTopRef.current
      lastScrollTopRef.current = currentScrollTop

      if (deferScrollButtonVisibilityRef.current) {
        return
      }

      const nearLiveEdge = isNearLiveEdge()
      let shouldShow = showScrollButtonRef.current

      if (nearLiveEdge) {
        shouldShow = false
      } else if (mode === 'programmatic-away') {
        shouldShow = true
      } else if (mode === 'user-scroll') {
        if (previousScrollTop === null) {
          shouldShow = false
        } else if (currentScrollTop < previousScrollTop) {
          shouldShow = true
        } else if (currentScrollTop > previousScrollTop) {
          shouldShow = false
        }
      }

      if (showScrollButtonRef.current !== shouldShow) {
        showScrollButtonRef.current = shouldShow
        setShowScrollButton(shouldShow)
      }

      if (
        !shouldShow &&
        replyJumpReturnPointRef.current !== null &&
        !preserveReplyJumpReturnPointRef.current
      ) {
        setReplyJumpReturnPoint(null)
      }
    },
    [isNearLiveEdge, setReplyJumpReturnPoint]
  )

  const handleScroll = useCallback(() => {
    updateScrollButtonVisibility('user-scroll')
  }, [updateScrollButtonVisibility])

  const hideScrollButton = useCallback(() => {
    if (!showScrollButtonRef.current) {
      return
    }

    showScrollButtonRef.current = false
    setShowScrollButton(false)
  }, [])

  const cancelReplyScrollAnimation = useCallback(() => {
    if (replyScrollAnimationRef.current !== null) {
      cancelAnimationFrame(replyScrollAnimationRef.current)
      replyScrollAnimationRef.current = null
    }
    preserveReplyJumpReturnPointRef.current = false
    deferScrollButtonVisibilityRef.current = false
  }, [])

  const scrollToPositionInFixedTime = useCallback(
    (
      endScrollTop: number,
      options: { preserveReplyReturnPoint?: boolean } = {}
    ) => {
      const scrollContainer = scrollContainerRef.current
      if (!scrollContainer) {
        return
      }

      cancelReplyScrollAnimation()
      deferScrollButtonVisibilityRef.current = true
      const shouldPreserveReplyReturnPoint = Boolean(
        options.preserveReplyReturnPoint &&
          replyJumpReturnPointRef.current !== null
      )
      preserveReplyJumpReturnPointRef.current = shouldPreserveReplyReturnPoint

      const maxScrollTop = getMaxScrollTop(scrollContainer)
      const clampedEndScrollTop = Math.min(
        Math.max(endScrollTop, 0),
        maxScrollTop
      )
      const startScrollTop = scrollContainer.scrollTop
      const scrollDistance = clampedEndScrollTop - startScrollTop

      if (shouldReduceScrollMotion() || Math.abs(scrollDistance) < 1) {
        scrollContainer.scrollTop = clampedEndScrollTop
        preserveReplyJumpReturnPointRef.current = false
        deferScrollButtonVisibilityRef.current = false
        updateScrollButtonVisibility(
          shouldPreserveReplyReturnPoint ? 'programmatic-away' : 'sync'
        )
        return
      }

      let startTime: number | null = null
      const animateScroll = (timestamp: number) => {
        startTime ??= timestamp
        const progress = Math.min(
          (timestamp - startTime) / CHAT_REPLY_SCROLL_DURATION_MS,
          1
        )
        const easedProgress = 1 - Math.pow(1 - progress, 3)
        scrollContainer.scrollTop =
          startScrollTop + scrollDistance * easedProgress

        if (progress < 1) {
          replyScrollAnimationRef.current = requestAnimationFrame(animateScroll)
        } else {
          replyScrollAnimationRef.current = null
          preserveReplyJumpReturnPointRef.current = false
          deferScrollButtonVisibilityRef.current = false
          updateScrollButtonVisibility(
            shouldPreserveReplyReturnPoint ? 'programmatic-away' : 'sync'
          )
        }
      }

      replyScrollAnimationRef.current = requestAnimationFrame(animateScroll)
    },
    [cancelReplyScrollAnimation, updateScrollButtonVisibility]
  )

  const scrollToBottom = useCallback(
    (options: { animated?: boolean } = {}) => {
      const container = scrollContainerRef.current
      if (!container) {
        return
      }

      const bottomScrollTop = getMaxScrollTop(container)
      setReplyJumpReturnPoint(null)

      if (options.animated) {
        scrollToPositionInFixedTime(bottomScrollTop)
        return
      }

      cancelReplyScrollAnimation()
      container.scrollTop = bottomScrollTop
      updateScrollButtonVisibility()
    },
    [
      cancelReplyScrollAnimation,
      scrollToPositionInFixedTime,
      setReplyJumpReturnPoint,
      updateScrollButtonVisibility
    ]
  )

  const loadMoreMessages = useCallback(async () => {
    if (historyLoadInFlightRef.current || loading || !hasMore) return

    const oldestMessageId = getOldestMessageId(messagesRef.current)
    if (!Number.isFinite(oldestMessageId)) {
      setHasMore(false)
      return
    }

    historyLoadInFlightRef.current = true
    setLoading(true)

    try {
      const response = await kunFetchGet<
        KunResponse<ConversationMessagesResponse>
      >(`/message/conversation/${conversationId}`, {
        page: 1,
        limit: 30,
        beforeId: oldestMessageId
      })

      if (typeof response === 'string') {
        toast.error(response)
      } else {
        const scrollContainer = scrollContainerRef.current
        const previousScrollHeight = scrollContainer?.scrollHeight || 0

        setMessages((prev) => {
          const mergedMessages = mergeMessagesById(prev, response.messages)
          messagesRef.current = mergedMessages
          return mergedMessages
        })
        setTotalCount(response.total)
        setHasMore(response.hasMoreBefore)

        requestAnimationFrame(() => {
          if (scrollContainer) {
            const newScrollHeight = scrollContainer.scrollHeight
            scrollContainer.scrollTop = newScrollHeight - previousScrollHeight
          }
        })
      }
    } catch {
      toast.error('获取历史消息失败，请稍后重试')
    } finally {
      historyLoadInFlightRef.current = false
      setLoading(false)
    }
  }, [loading, hasMore, conversationId])

  const handleMessageSent = useCallback(
    (newMessage: PrivateMessage) => {
      const message: PrivateMessage = {
        id: newMessage.id,
        type: newMessage.type ?? 0,
        content: newMessage.content,
        status: newMessage.status ?? 0,
        isDeleted: newMessage.isDeleted ?? false,
        image: newMessage.image ?? null,
        images: newMessage.images ?? undefined,
        replyTo: newMessage.replyTo ?? null,
        editedAt: newMessage.editedAt ?? null,
        created: newMessage.created,
        sender: newMessage.sender ?? {
          id: user.uid,
          name: user.name,
          avatar: user.avatar
        }
      }
      setMessages((prev) => sortMessagesByTime([...prev, message]))
      setTotalCount((prev) => prev + 1)
      requestAnimationFrame(() => {
        scrollToBottom()
      })
    },
    [user, scrollToBottom]
  )

  const handleMessageUpdated = useCallback(
    (messageId: number, data: MessageUpdateData) => {
      if (data.action === 'delete') {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId
              ? {
                  ...msg,
                  type: 0,
                  content: '',
                  isDeleted: true,
                  image: null,
                  images: [],
                  replyTo: null
                }
              : msg
          )
        )
      } else {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId
              ? { ...msg, content: data.content, editedAt: data.editedAt }
              : msg
          )
        )
      }
    },
    []
  )

  const handleOpenImage = useCallback(
    (message: PrivateMessage, imageIndex: number) => {
      const targetIndex = conversationImages.findIndex(
        (image) =>
          image.messageId === message.id && image.imageIndex === imageIndex
      )

      if (targetIndex >= 0) {
        setImageViewerIndex(targetIndex)
      }
    },
    [conversationImages]
  )

  const scrollToMessageInFixedTime = useCallback(
    (messageId: number) => {
      const target = document.getElementById(`chat-message-${messageId}`)
      const scrollContainer = scrollContainerRef.current

      if (!target || !scrollContainer) {
        target?.scrollIntoView({ behavior: 'auto', block: 'center' })
        return
      }

      const containerRect = scrollContainer.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      const startScrollTop = scrollContainer.scrollTop
      const centeredScrollTop =
        startScrollTop +
        targetRect.top -
        containerRect.top -
        (scrollContainer.clientHeight - targetRect.height) / 2
      scrollToPositionInFixedTime(centeredScrollTop, {
        preserveReplyReturnPoint: true
      })
    },
    [scrollToPositionInFixedTime]
  )

  const startReplyHighlight = useCallback((highlight: ChatReplyHighlight) => {
    if (replyHighlightTimerRef.current) {
      clearTimeout(replyHighlightTimerRef.current)
      replyHighlightTimerRef.current = null
    }
    setReplyHighlight(null)
    setIsReplyHighlightFading(false)

    replyHighlightTimerRef.current = setTimeout(() => {
      setReplyHighlight(highlight)
      setIsReplyHighlightFading(false)
      replyHighlightTimerRef.current = setTimeout(() => {
        setIsReplyHighlightFading(true)
        replyHighlightTimerRef.current = setTimeout(() => {
          setReplyHighlight((current) =>
            current?.messageId === highlight.messageId ? null : current
          )
          setIsReplyHighlightFading(false)
          replyHighlightTimerRef.current = null
        }, CHAT_REPLY_HIGHLIGHT_FADE_MS)
      }, CHAT_REPLY_HIGHLIGHT_VISIBLE_MS)
    }, CHAT_REPLY_HIGHLIGHT_DELAY_MS)
  }, [])

  const handleJumpToReply = useCallback(
    (replyTo: PrivateMessageReplyPreview, sourceMessageId: number) => {
      const highlight = getReplyHighlight(replyTo)

      const target = document.getElementById(
        `chat-message-${replyTo.messageId}`
      )
      const scrollContainer = scrollContainerRef.current
      if (target && scrollContainer) {
        setReplyJumpReturnPoint(scrollContainer.scrollTop, sourceMessageId)
      } else {
        setReplyJumpReturnPoint(null)
      }

      scrollToMessageInFixedTime(replyTo.messageId)
      startReplyHighlight(highlight)
    },
    [scrollToMessageInFixedTime, setReplyJumpReturnPoint, startReplyHighlight]
  )

  const handleScrollButtonClick = useCallback(() => {
    const returnPoint = replyJumpReturnPointRef.current
    const returnMessageId = replyJumpReturnMessageIdRef.current

    if (returnPoint !== null) {
      setReplyJumpReturnPoint(null)
      scrollToPositionInFixedTime(returnPoint)
      if (returnMessageId !== null) {
        startReplyHighlight({
          messageId: returnMessageId,
          kind: 'bubble'
        })
      }
      return
    }

    hideScrollButton()
    scrollToBottom({ animated: true })
  }, [
    hideScrollButton,
    scrollToBottom,
    scrollToPositionInFixedTime,
    setReplyJumpReturnPoint,
    startReplyHighlight
  ])

  useEffect(() => {
    return () => {
      if (replyHighlightTimerRef.current) {
        clearTimeout(replyHighlightTimerRef.current)
      }
      if (replyScrollAnimationRef.current !== null) {
        cancelAnimationFrame(replyScrollAnimationRef.current)
      }
      if (scrollButtonUnmountTimerRef.current) {
        clearTimeout(scrollButtonUnmountTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    document.title = `与${otherUser.name}的私聊 - TouchGal`
  }, [otherUser.name])

  useEffect(() => {
    let ignore = false

    const markAsRead = async () => {
      try {
        const response = await kunFetchPut<KunResponse<MessageUnreadStatus>>(
          `/message/conversation/${conversationId}/read`
        )

        if (ignore) {
          return
        }

        if (typeof response === 'string') {
          toast.error(response)
          return
        }

        setUnreadMessageStatus(response)
      } catch {
        if (!ignore) {
          toast.error('同步私聊已读状态失败，请稍后重试')
        }
      }
    }

    void markAsRead()

    return () => {
      ignore = true
    }
  }, [conversationId, setUnreadMessageStatus])

  useEffect(() => {
    let ignore = false
    let realtimePollInFlight = false

    const clearRealtimePollTimer = () => {
      if (!realtimePollTimerRef.current) {
        return
      }

      clearTimeout(realtimePollTimerRef.current)
      realtimePollTimerRef.current = null
    }

    const scheduleRealtimePoll = (interval: number) => {
      clearRealtimePollTimer()
      realtimePollTimerRef.current = setTimeout(pollNewMessages, interval)
    }

    const getRealtimePollInterval = () =>
      document.visibilityState === 'hidden'
        ? CHAT_HIDDEN_POLL_INTERVAL_MS
        : CHAT_VISIBLE_POLL_INTERVAL_MS

    const pollNewMessages = async () => {
      if (realtimePollInFlight) {
        return
      }

      if (document.visibilityState === 'hidden') {
        if (!ignore) {
          scheduleRealtimePoll(CHAT_HIDDEN_POLL_INTERVAL_MS)
        }
        return
      }

      realtimePollInFlight = true
      const latestMessageId = realtimeCursorRef.current
      const query: Record<string, number> = { page: 1, limit: 50 }
      if (latestMessageId > 0) {
        query.afterId = latestMessageId
      }

      try {
        const response = await kunFetchGet<
          KunResponse<ConversationMessagesResponse>
        >(`/message/conversation/${conversationId}`, query)

        if (ignore || typeof response === 'string') {
          return
        }

        const newMessages = response.messages
        if (newMessages.length) {
          const shouldScrollToLiveEdge = isNearLiveEdge()
          realtimeCursorRef.current = Math.max(
            realtimeCursorRef.current,
            getLatestMessageId(newMessages)
          )
          const hasOtherUserMessage = newMessages.some(
            (msg) => msg.sender.id !== user.uid
          )

          const currentMessages = messagesRef.current
          const mergedMessages = mergeMessagesById(currentMessages, newMessages)
          const addedMessageCount = Math.max(
            mergedMessages.length - currentMessages.length,
            0
          )

          if (addedMessageCount > 0) {
            messagesRef.current = mergedMessages
            setMessages(mergedMessages)
            setTotalCount((currentTotal) => currentTotal + addedMessageCount)
          }

          if (hasOtherUserMessage) {
            try {
              const readResponse = await kunFetchPut<
                KunResponse<MessageUnreadStatus>
              >(`/message/conversation/${conversationId}/read`)

              if (ignore) {
                return
              }

              if (typeof readResponse === 'string') {
                toast.error(readResponse)
              } else {
                setUnreadMessageStatus(readResponse)
              }
            } catch {
              if (!ignore) {
                toast.error('同步私聊已读状态失败，请稍后重试')
              }
            }
          }

          if (shouldScrollToLiveEdge) {
            requestAnimationFrame(() => {
              scrollToBottom()
            })
          }
        }

        const currentLatestMessageId = getNextMessageId(messagesRef.current)
        if (currentLatestMessageId > 1) {
          const statusResponse = await kunFetchGet<
            KunResponse<ConversationMessagesResponse>
          >(`/message/conversation/${conversationId}`, {
            page: 1,
            limit: 50,
            beforeId: currentLatestMessageId
          })

          if (!ignore && typeof statusResponse !== 'string') {
            const mergedMessages = mergeMessagesById(
              messagesRef.current,
              statusResponse.messages
            )
            messagesRef.current = mergedMessages
            setMessages(mergedMessages)
          }
        }
      } catch {
      } finally {
        realtimePollInFlight = false
        if (!ignore) {
          scheduleRealtimePoll(getRealtimePollInterval())
        }
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        clearRealtimePollTimer()
        void pollNewMessages()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    clearRealtimePollTimer()
    void pollNewMessages()

    return () => {
      ignore = true
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      clearRealtimePollTimer()
    }
  }, [
    conversationId,
    isNearLiveEdge,
    scrollToBottom,
    setUnreadMessageStatus,
    user.uid
  ])

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      scrollToBottom()
    }
  }, [scrollToBottom])

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) {
      return
    }

    scrollContainer.addEventListener('scroll', handleScroll, {
      passive: true
    })
    updateScrollButtonVisibility()

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll)
    }
  }, [handleScroll, updateScrollButtonVisibility])

  useEffect(() => {
    if (showScrollButton) {
      if (scrollButtonUnmountTimerRef.current) {
        clearTimeout(scrollButtonUnmountTimerRef.current)
        scrollButtonUnmountTimerRef.current = null
      }
      setIsScrollButtonMounted(true)
      return
    }

    if (!isScrollButtonMounted) {
      return
    }

    const timer = setTimeout(() => {
      setIsScrollButtonMounted(false)
      scrollButtonUnmountTimerRef.current = null
    }, CHAT_SCROLL_BUTTON_FADE_MS)
    scrollButtonUnmountTimerRef.current = timer

    return () => {
      clearTimeout(timer)
      if (scrollButtonUnmountTimerRef.current === timer) {
        scrollButtonUnmountTimerRef.current = null
      }
    }
  }, [isScrollButtonMounted, showScrollButton])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          loadMoreMessages()
        }
      },
      { threshold: 0.1 }
    )

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current)
    }

    return () => observer.disconnect()
  }, [hasMore, loading, loadMoreMessages])

  const scrollButtonLabel =
    replyJumpReturnPoint !== null ? '回到回复消息位置' : '回到底部'

  return (
    <>
      <Card className={cn('h-[calc(100vh-200px)] min-h-[500px]', className)}>
        <CardHeader className="border-b border-default-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button
              as={Link}
              href="/message/chat"
              variant="light"
              isIconOnly
              size="sm"
            >
              <ArrowLeft className="size-4" />
            </Button>
            <KunAvatar
              uid={otherUser.id}
              avatarProps={{
                src: otherUser.avatar,
                name: otherUser.name,
                size: 'sm'
              }}
            />
            <span className="font-semibold">{otherUser.name}</span>
          </div>

          <DeleteConversationButton
            conversationId={conversationId}
            otherUserName={otherUser.name}
          />
        </CardHeader>

        <CardBody className="relative flex flex-col p-0">
          {isScrollButtonMounted && (
            <div
              data-testid="chat-scroll-button-shell"
              data-state={showScrollButton ? 'open' : 'closed'}
              aria-hidden={!showScrollButton}
              className={cn(
                CHAT_SCROLL_BUTTON_POSITION_CLASSNAME,
                'transition-opacity duration-[180ms] motion-reduce:transition-none',
                showScrollButton
                  ? 'opacity-100 ease-out'
                  : 'pointer-events-none opacity-0 ease-out'
              )}
            >
              <button
                type="button"
                aria-label={scrollButtonLabel}
                title={scrollButtonLabel}
                tabIndex={showScrollButton ? 0 : -1}
                className={cn(
                  'pointer-events-auto flex size-11 items-center justify-center rounded-full border border-default-200 bg-content1/95 text-default-600 shadow-lg shadow-default-900/10 outline-none backdrop-blur-md transition-[background-color,color,box-shadow] duration-200 hover:bg-content2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-[hsl(var(--kun-brand-500)/0.55)] active:bg-content2 active:text-foreground dark:border-default-100/10 dark:bg-content2/95 dark:shadow-black/25',
                  !showScrollButton && 'pointer-events-none'
                )}
                onClick={handleScrollButtonClick}
              >
                <ChevronDown className="size-6" aria-hidden="true" />
              </button>
            </div>
          )}

          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4">
            {hasMore && (
              <div ref={loadMoreRef} className="flex justify-center py-2">
                {loading && (
                  <Loader2 className="size-5 animate-spin text-default-400" />
                )}
              </div>
            )}

            {messages.length === 0 ? (
              <KunNull message="暂无消息，发送第一条消息吧" />
            ) : (
              <>
                {messages.map((msg) => (
                  <ChatMessage
                    key={msg.id}
                    message={msg}
                    isOwn={msg.sender.id === user.uid}
                    conversationId={conversationId}
                    onReply={(message, selectedText, imageIndex) =>
                      setReplyDraft({ message, selectedText, imageIndex })
                    }
                    onOpenImage={handleOpenImage}
                    onReplyPreviewClick={handleJumpToReply}
                    replyHighlight={
                      replyHighlight?.messageId === msg.id
                        ? replyHighlight
                        : null
                    }
                    isReplyHighlightFading={
                      replyHighlight?.messageId === msg.id &&
                      isReplyHighlightFading
                    }
                    onMessageUpdated={(data) =>
                      handleMessageUpdated(msg.id, data)
                    }
                  />
                ))}
              </>
            )}
          </div>

          <div className="px-3 pb-3 pt-2">
            <div className="relative z-30 rounded-2xl border border-default-200/80 bg-content1/95 p-3 shadow-[0_-10px_30px_hsl(var(--heroui-foreground)/0.06)] backdrop-blur-md dark:border-default-100/10 dark:bg-content1/90">
              <ChatInput
                conversationId={conversationId}
                replyTarget={replyDraft?.message}
                replySelectedText={replyDraft?.selectedText ?? null}
                replyImageIndex={replyDraft?.imageIndex ?? null}
                onCancelReply={() => setReplyDraft(null)}
                onMessageSent={handleMessageSent}
              />
            </div>
          </div>
        </CardBody>
      </Card>

      <KunControlledImageViewer
        images={conversationImages}
        index={imageViewerIndex}
        preload={2}
        onClose={() => setImageViewerIndex(-1)}
        onView={setImageViewerIndex}
      />
    </>
  )
}
