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
import { ChatWriteSession } from '~/hooks/usePrivateChatRequest'
import { kunFetchGet, KunFetchError } from '~/utils/kunFetch'
import { refreshUserSession } from '~/utils/sessionClient'
import type { UserState } from '~/store/userStore'
import type { ReactNode } from 'react'
import { usePrivateChatSync } from '~/hooks/usePrivateChatSync'
import { chatReviewTargets, mergeChatMessages } from '~/utils/privateChatSync'
import { useUserStore } from '~/store/userStore'
import { cn } from '~/utils/cn'
import toast from 'react-hot-toast'
import type {
  ConversationMessagesResponse,
  PrivateMessage,
  PrivateMessageReplyPreview
} from '~/types/api/conversation'
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
  initialSessionContext: string
  initialMessages: PrivateMessage[]
  total: number
  hasMoreBefore?: boolean
  otherUser: KunUser
  className?: string
}

const sortMessagesById = (msgs: PrivateMessage[]) => {
  return [...msgs].sort((left, right) => left.id - right.id)
}

const CHAT_REPLY_SCROLL_DURATION_MS = 420
const CHAT_REPLY_HIGHLIGHT_DELAY_MS = 500
const CHAT_REPLY_HIGHLIGHT_VISIBLE_MS = 1_200
const CHAT_REPLY_HIGHLIGHT_FADE_MS = 260
const CHAT_LIVE_EDGE_THRESHOLD_PX = 96
const CHAT_SCROLL_BUTTON_FADE_MS = 180
const CHAT_SCROLL_BUTTON_POSITION_CLASSNAME =
  'pointer-events-none absolute bottom-full right-8 z-40 mb-2'
type ScrollButtonVisibilityMode = 'sync' | 'user-scroll' | 'programmatic-away'

const getMaxScrollTop = (container: HTMLElement) =>
  Math.max(0, container.scrollHeight - container.clientHeight)

const shouldReduceScrollMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const getLatestMessageId = (msgs: PrivateMessage[]) =>
  msgs.reduce((latest, msg) => Math.max(latest, msg.id), 0)

const getOldestMessageId = (msgs: PrivateMessage[]) =>
  msgs.reduce(
    (oldest, msg) => Math.min(oldest, msg.id),
    Number.POSITIVE_INFINITY
  )

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

const ChatConversation = ({
  conversationId,
  initialSessionContext,
  initialMessages,
  total,
  hasMoreBefore,
  otherUser,
  className,
  owner,
  notice
}: Props & { owner: UserState; notice: ReactNode }) => {
  const [messages, setMessages] = useState<PrivateMessage[]>(
    sortMessagesById(initialMessages)
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
  const [activeImage, setActiveImage] = useState<string | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const stickerPickerPortalRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const user = owner
  const deletedIdsRef = useRef(
    new Set(
      initialMessages
        .filter((message) => message.isDeleted)
        .map((message) => message.id)
    )
  )
  const reviewCacheRef = useRef(new Map<number, PrivateMessage>())
  const replyDraftRef = useRef(replyDraft)
  replyDraftRef.current = replyDraft
  const activeImageMessageIdRef = useRef<number | null>(null)
  const requestedReviewRef = useRef<() => void>(() => {})
  const isInitialMount = useRef(true)
  const messagesRef = useRef(messages)
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
    if (!replyTarget || replyTarget.isDeleted) setReplyDraft(null)
    else if (replyTarget !== replyDraft.message)
      setReplyDraft({ ...replyDraft, message: replyTarget })
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

  const imageViewerIndex = conversationImages.findIndex(
    (image) =>
      `${image.messageId}:${image.imageIndex}:${image.src}` === activeImage
  )
  activeImageMessageIdRef.current =
    conversationImages[imageViewerIndex]?.messageId ?? null

  const viewImage = useCallback(
    (index: number) => {
      const image = conversationImages[index]
      setActiveImage(
        image ? `${image.messageId}:${image.imageIndex}:${image.src}` : null
      )
      requestedReviewRef.current()
    },
    [conversationImages]
  )

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
    requestedReviewRef.current()
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

  const mergeIncoming = useCallback(
    (
      incoming: PrivateMessage[],
      reviews: PrivateMessage[] = [],
      unavailable: number[] = []
    ) => {
      const merged = mergeChatMessages(
        messagesRef.current,
        incoming,
        reviews,
        unavailable,
        deletedIdsRef.current,
        reviewCacheRef.current
      )
      messagesRef.current = merged
      setMessages(merged)
      return merged
    },
    []
  )

  const getReviewIds = useCallback(() => {
    const container = scrollContainerRef.current
    const bounds = container?.getBoundingClientRect()
    const visible = messagesRef.current.filter((message) => {
      const element = document.getElementById(`chat-message-${message.id}`)
      if (!container?.clientHeight || !bounds) return true
      if (!element) return false
      const rectangle = element.getBoundingClientRect()
      return rectangle.bottom > bounds.top && rectangle.top < bounds.bottom
    })
    return chatReviewTargets(
      [
        activeImageMessageIdRef.current ?? 0,
        replyDraftRef.current?.message.id ?? 0
      ],
      visible
    )
  }, [])

  const applyBatch = useCallback(
    (response: ConversationMessagesResponse, direction: 'new' | 'history') => {
      const container = scrollContainerRef.current
      const previousTop = container?.scrollTop ?? 0
      const previousHeight = container?.scrollHeight ?? 0
      const bounds = container?.getBoundingClientRect()
      const anchor = messagesRef.current
        .map((message) => document.getElementById(`chat-message-${message.id}`))
        .find(
          (element) =>
            element &&
            bounds &&
            element.getBoundingClientRect().bottom > bounds.top
        )
      const anchorOffset =
        anchor && bounds
          ? anchor.getBoundingClientRect().top - bounds.top
          : null
      const follow =
        direction === 'new' && response.messages.length > 0 && isNearLiveEdge()
      const previousCount = messagesRef.current.length
      const merged = mergeIncoming(
        response.messages,
        response.reviewMessages,
        response.unavailableIds
      )
      setTotalCount((count) =>
        Math.max(count, count + merged.length - previousCount)
      )
      if (direction === 'history') setHasMore(response.hasMoreBefore)
      requestAnimationFrame(() => {
        if (!container || scrollContainerRef.current !== container) return
        if (follow) scrollToBottom()
        else if (anchor?.isConnected && anchorOffset !== null) {
          container.scrollTop +=
            anchor.getBoundingClientRect().top -
            container.getBoundingClientRect().top -
            anchorOffset
        } else if (direction === 'history')
          container.scrollTop =
            previousTop + container.scrollHeight - previousHeight
        else container.scrollTop = previousTop
      })
    },
    [isNearLiveEdge, mergeIncoming, scrollToBottom]
  )

  const {
    failed: syncFailed,
    recordActivity,
    requestReview,
    loadHistory
  } = usePrivateChatSync({
    conversationId,
    initialSessionContext,
    initialCursor: getLatestMessageId(messagesRef.current),
    getReviewIds,
    onBatch: applyBatch
  })
  requestedReviewRef.current = requestReview
  useEffect(() => {
    requestReview()
  }, [replyDraft?.message.id, activeImage, requestReview])

  const loadMoreMessages = useCallback(async () => {
    if (
      !initialSessionContext ||
      historyLoadInFlightRef.current ||
      loading ||
      !hasMore
    )
      return
    const oldestMessageId = getOldestMessageId(messagesRef.current)
    if (!Number.isFinite(oldestMessageId)) return
    historyLoadInFlightRef.current = true
    setLoading(true)
    const response = await loadHistory(oldestMessageId)
    if (!response && document.visibilityState !== 'hidden')
      toast.error('获取历史消息失败，请稍后重试')
    historyLoadInFlightRef.current = false
    setLoading(false)
  }, [hasMore, loading, loadHistory, initialSessionContext])

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
        stickerId: newMessage.stickerId ?? null,
        sticker: newMessage.sticker ?? null,
        replyTo: newMessage.replyTo ?? null,
        editedAt: newMessage.editedAt ?? null,
        created: newMessage.created,
        sender: newMessage.sender ?? {
          id: user.uid,
          name: user.name,
          avatar: user.avatar
        }
      }
      mergeIncoming([message])
      recordActivity()
      setTotalCount((prev) => prev + 1)
      requestAnimationFrame(() => {
        scrollToBottom()
      })
    },
    [user, scrollToBottom, mergeIncoming, recordActivity]
  )

  const handleMessageUpdated = useCallback(
    (messageId: number, data: MessageUpdateData) => {
      recordActivity()
      if (data.action === 'delete') mergeIncoming([], [], [messageId])
      else {
        const current = messagesRef.current.find(
          (message) => message.id === messageId
        )
        if (current)
          mergeIncoming(
            [],
            [{ ...current, content: data.content, editedAt: data.editedAt }]
          )
      }
    },
    [mergeIncoming, recordActivity]
  )

  const handleOpenImage = useCallback(
    (message: PrivateMessage, imageIndex: number) => {
      const targetIndex = conversationImages.findIndex(
        (image) =>
          image.messageId === message.id && image.imageIndex === imageIndex
      )

      if (targetIndex >= 0) {
        viewImage(targetIndex)
      }
    },
    [conversationImages, viewImage]
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
      requestedReviewRef.current()
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
    document.title = `与${otherUser.name}的私聊 - OtoAme`
  }, [otherUser.name])

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
      <Card
        className={cn(
          'h-[calc(100vh-200px)] min-h-[500px] bg-[var(--kun-chat-panel-bg)] text-[var(--kun-chat-text-primary)]',
          className
        )}
      >
        <CardHeader className="flex items-center justify-between gap-3 border-b border-[var(--kun-chat-panel-border)]">
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

          {syncFailed && (
            <span role="status" className="text-xs text-warning">
              消息同步暂时不可用，将自动重试
            </span>
          )}
          {initialSessionContext && (
            <DeleteConversationButton
              conversationId={conversationId}
              otherUserName={otherUser.name}
            />
          )}
        </CardHeader>

        <CardBody className="relative flex flex-col p-0">
          <div className="relative min-h-0 min-w-0 flex-1">
            <div
              ref={scrollContainerRef}
              className="@container h-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4"
            >
              {hasMore && (
                <div ref={loadMoreRef} className="flex justify-center py-2">
                  {loading && (
                    <Loader2 className="size-5 animate-spin text-[var(--kun-chat-muted-text)]" />
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
                      onReply={(message, selectedText, imageIndex) => {
                        setReplyDraft({ message, selectedText, imageIndex })
                        requestReview()
                      }}
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
            <div
              ref={stickerPickerPortalRef}
              data-testid="sticker-picker-portal"
              className="@container pointer-events-none absolute inset-0 z-40"
            />
          </div>

          <div className="relative px-3 pb-3 pt-2">
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
                    'pointer-events-auto flex size-11 items-center justify-center rounded-full border border-[var(--kun-chat-panel-border)] bg-[var(--kun-chat-menu-bg)] text-[var(--kun-chat-text-secondary)] shadow-lg shadow-default-900/10 outline-none backdrop-blur-md transition-[background-color,color,box-shadow] duration-200 hover:bg-[var(--kun-chat-menu-item-hover-bg)] hover:text-[var(--kun-chat-text-primary)] focus-visible:ring-2 focus-visible:ring-[hsl(var(--kun-brand-500)/0.55)] active:bg-[var(--kun-chat-menu-item-hover-bg)] active:text-[var(--kun-chat-text-primary)] dark:shadow-black/25',
                    !showScrollButton && 'pointer-events-none'
                  )}
                  onClick={handleScrollButtonClick}
                >
                  <ChevronDown className="size-6" aria-hidden="true" />
                </button>
              </div>
            )}

            <div className="relative z-30 rounded-2xl border border-[var(--kun-chat-panel-border)] bg-[var(--kun-chat-panel-bg)] p-3 shadow-[var(--kun-chat-panel-shadow)] backdrop-blur-md">
              {notice}
              <ChatInput
                conversationId={conversationId}
                replyTarget={replyDraft?.message}
                replySelectedText={replyDraft?.selectedText ?? null}
                replyImageIndex={replyDraft?.imageIndex ?? null}
                onCancelReply={() => setReplyDraft(null)}
                onMessageSent={handleMessageSent}
                stickerPickerPortalRef={stickerPickerPortalRef}
              />
            </div>
          </div>
        </CardBody>
      </Card>

      <KunControlledImageViewer
        images={conversationImages}
        index={imageViewerIndex}
        preload={2}
        onClose={() => setActiveImage(null)}
        onView={viewImage}
      />
    </>
  )
}

// Pin the already displayed conversation to its original owner. Restoring a
// different authenticated session also requires a fresh membership check.
const ChatSession = (props: Props) => {
  const { user, sessionStatus, sessionContext, sessionGeneration } =
    useUserStore()
  const [access, setAccess] = useState<{
    owner: UserState
    context: string
    generation: number
  } | null>(null)
  const [failure, setFailure] = useState('')
  const [attempt, setAttempt] = useState(0)
  const sameSession =
    access !== null &&
    user.uid === access.owner.uid &&
    sessionContext === access.context &&
    sessionGeneration === access.generation
  const active = sessionStatus === 'authenticated' && sameSession

  useEffect(() => {
    if (sessionStatus !== 'authenticated' || !sessionContext || !user.uid)
      return
    if (!access) {
      if (sessionContext === props.initialSessionContext)
        setAccess({
          owner: user,
          context: sessionContext,
          generation: sessionGeneration
        })
      return
    }
    if (user.uid !== access.owner.uid || active) return
    const controller = new AbortController()
    const isCurrent = () => {
      const current = useUserStore.getState()
      return (
        !controller.signal.aborted &&
        current.sessionStatus === 'authenticated' &&
        current.sessionContext === sessionContext &&
        current.sessionGeneration === sessionGeneration
      )
    }
    setFailure('')
    void kunFetchGet<ConversationMessagesResponse>(
      `/message/conversation/${props.conversationId}`,
      { page: 1, limit: 1 },
      {
        headers: { 'X-Kun-Chat-Session': sessionContext },
        signal: controller.signal,
        timeout: 15_000,
        preserveErrorStatus: true
      }
    )
      .then((page) => {
        if (!isCurrent()) return
        if (
          !Array.isArray(page?.messages) ||
          page.otherUser?.id !== props.otherUser.id
        ) {
          setFailure('无法确认对话成员资格')
          return
        }
        setAccess({
          owner: access.owner,
          context: sessionContext,
          generation: sessionGeneration
        })
      })
      .catch((error) => {
        if (!isCurrent()) return
        if (error instanceof KunFetchError && error.status === 401) {
          void refreshUserSession()
        } else {
          setFailure(
            error instanceof KunFetchError && error.status === 403
              ? '当前账号已无权访问此对话'
              : '暂时无法确认对话，请重试'
          )
        }
      })
    return () => controller.abort()
  }, [
    access,
    active,
    attempt,
    props.conversationId,
    props.initialSessionContext,
    props.otherUser.id,
    sessionContext,
    sessionGeneration,
    sessionStatus,
    user.uid
  ])

  const guest = sessionStatus === 'guest'
  const switched =
    sessionStatus === 'authenticated' &&
    access !== null &&
    user.uid !== access.owner.uid
  const unavailable = sessionStatus === 'unavailable'
  const notice = active ? null : (
    <div role="status" className="mb-2 text-sm text-default-600">
      {guest
        ? '已退出登录，当前对话已暂停。'
        : switched
          ? '账号已切换，当前对话已暂停。'
          : unavailable
            ? '暂时无法确认登录状态。'
            : failure || '正在确认对话…'}
      {guest && (
        <Link
          href="/login"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary"
        >
          登录
        </Link>
      )}
      {(unavailable || (!switched && !guest && failure)) && (
        <Button
          size="sm"
          variant="light"
          onPress={() =>
            unavailable ? void refreshUserSession() : setAttempt((n) => n + 1)
          }
        >
          重试
        </Button>
      )}
    </div>
  )
  if (!access) {
    if (
      sessionStatus === 'authenticated' &&
      sessionContext !== props.initialSessionContext
    )
      return <Link href="/message/chat">账号已变化，返回私聊列表</Link>
    return notice
  }
  const allowed = active ? access.context : null
  return (
    <ChatWriteSession.Provider value={allowed}>
      <ChatConversation
        {...props}
        initialSessionContext={sameSession ? access.context : ''}
        owner={access.owner}
        notice={notice}
      />
    </ChatWriteSession.Provider>
  )
}

export const ChatContainer = (props: Props) => (
  <ChatSession
    key={`${props.conversationId}:${props.initialSessionContext}`}
    {...props}
  />
)
