'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Card, CardBody, CardHeader } from '@heroui/card'
import { Button } from '@heroui/react'
import { ArrowLeft, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { KunNull } from '~/components/kun/Null'
import { ChatMessage } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { DeleteConversationButton } from './DeleteConversationButton'
import { KunAvatar } from '~/components/kun/floating-card/KunAvatar'
import { kunFetchGet, kunFetchPut } from '~/utils/kunFetch'
import { useUserStore } from '~/store/userStore'
import { useMessageStore } from '~/store/messageStore'
import toast from 'react-hot-toast'
import type { PrivateMessage } from '~/types/api/conversation'
import type { MessageUnreadStatus } from '~/types/api/message'

type MessageUpdateData =
  | { action: 'delete' }
  | { action: 'edit'; content: string; editedAt: string | Date }

interface Props {
  conversationId: number
  initialMessages: PrivateMessage[]
  total: number
  otherUser: KunUser
}

const sortMessagesByTime = (msgs: PrivateMessage[]) => {
  return [...msgs].sort(
    (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime()
  )
}

const CHAT_VISIBLE_POLL_INTERVAL_MS = 2_000
const CHAT_HIDDEN_POLL_INTERVAL_MS = 15_000

const getLatestMessageId = (msgs: PrivateMessage[]) =>
  msgs.reduce((latest, msg) => Math.max(latest, msg.id), 0)

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

export const ChatContainer = ({
  conversationId,
  initialMessages,
  total,
  otherUser
}: Props) => {
  const [messages, setMessages] = useState<PrivateMessage[]>(
    sortMessagesByTime(initialMessages)
  )
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(initialMessages.length < total)
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(total)
  const [replyDraft, setReplyDraft] = useState<{
    message: PrivateMessage
    selectedText: string | null
  } | null>(null)
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

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [])

  const loadMoreMessages = useCallback(async () => {
    if (loading || !hasMore) return

    setLoading(true)
    const nextPage = page + 1

    const response = await kunFetchGet<
      KunResponse<{
        messages: PrivateMessage[]
        total: number
        otherUser: KunUser
      }>
    >(`/message/conversation/${conversationId}`, {
      page: nextPage,
      limit: 30
    })

    if (typeof response === 'string') {
      toast.error(response)
    } else {
      const scrollContainer = scrollContainerRef.current
      const previousScrollHeight = scrollContainer?.scrollHeight || 0

      setMessages((prev) => {
        const newMessages = [...response.messages, ...prev]
        return sortMessagesByTime(newMessages)
      })
      setPage(nextPage)
      setTotalCount(response.total)
      setHasMore((page + 1) * 30 < response.total)

      requestAnimationFrame(() => {
        if (scrollContainer) {
          const newScrollHeight = scrollContainer.scrollHeight
          scrollContainer.scrollTop = newScrollHeight - previousScrollHeight
        }
      })
    }

    setLoading(false)
  }, [loading, hasMore, page, conversationId])

  const handleMessageSent = useCallback(
    (newMessage: PrivateMessage) => {
      const message: PrivateMessage = {
        id: newMessage.id,
        type: newMessage.type ?? 0,
        content: newMessage.content,
        status: newMessage.status ?? 0,
        isDeleted: newMessage.isDeleted ?? false,
        image: newMessage.image ?? null,
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
            msg.id === messageId ? { ...msg, isDeleted: true } : msg
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

  useEffect(() => {
    document.title = `与${otherUser.name}的私聊 - TouchGal`
  }, [otherUser.name])

  useEffect(() => {
    const markAsRead = async () => {
      const response = await kunFetchPut<KunResponse<MessageUnreadStatus>>(
        `/message/conversation/${conversationId}/read`
      )
      if (typeof response !== 'string') {
        setUnreadMessageStatus(response)
      }
    }
    markAsRead()
  }, [conversationId, setUnreadMessageStatus])

  useEffect(() => {
    let ignore = false

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

    const pollNewMessages = async () => {
      if (document.visibilityState === 'hidden') {
        if (!ignore) {
          scheduleRealtimePoll(CHAT_HIDDEN_POLL_INTERVAL_MS)
        }
        return
      }

      const latestMessageId = realtimeCursorRef.current
      const query: Record<string, number> = { page: 1, limit: 50 }
      if (latestMessageId > 0) {
        query.afterId = latestMessageId
      }

      try {
        const response = await kunFetchGet<
          KunResponse<{
            messages: PrivateMessage[]
            total: number
            otherUser: KunUser
          }>
        >(`/message/conversation/${conversationId}`, query)

        if (ignore || typeof response === 'string') {
          return
        }

        const newMessages = response.messages
        if (newMessages.length) {
          realtimeCursorRef.current = Math.max(
            realtimeCursorRef.current,
            getLatestMessageId(newMessages)
          )
          const hasOtherUserMessage = newMessages.some(
            (msg) => msg.sender.id !== user.uid
          )

          const currentMessages = messagesRef.current
          const mergedMessages = mergeMessagesById(
            currentMessages,
            newMessages
          )
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
            const readResponse = await kunFetchPut<
              KunResponse<MessageUnreadStatus>
            >(`/message/conversation/${conversationId}/read`)

            if (!ignore && typeof readResponse !== 'string') {
              setUnreadMessageStatus(readResponse)
            }
          }

          requestAnimationFrame(() => {
            scrollToBottom()
          })
        }
      } catch {
      } finally {
        if (!ignore) {
          scheduleRealtimePoll(CHAT_VISIBLE_POLL_INTERVAL_MS)
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
  }, [conversationId, scrollToBottom, setUnreadMessageStatus, user.uid])

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      scrollToBottom()
    }
  }, [scrollToBottom])

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

  return (
    <Card className="h-[calc(100vh-200px)] min-h-[500px]">
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

      <CardBody className="flex flex-col p-0">
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
                  onMessageUpdated={(data) =>
                    handleMessageUpdated(msg.id, data)
                  }
                />
              ))}
            </>
          )}
        </div>

        <div className="border-t border-default-200 p-4">
          <ChatInput
            conversationId={conversationId}
            replyTarget={replyDraft?.message}
            replySelectedText={replyDraft?.selectedText ?? null}
            onCancelReply={() => setReplyDraft(null)}
            onMessageSent={handleMessageSent}
          />
        </div>
      </CardBody>
    </Card>
  )
}
