'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMounted } from '~/hooks/useMounted'
import { KunLoading } from '~/components/kun/Loading'
import { KunNull } from '~/components/kun/Null'
import { KunPagination } from '~/components/kun/Pagination'
import { ConversationCard } from './ConversationCard'
import { kunFetchGet } from '~/utils/kunFetch'
import toast from 'react-hot-toast'
import { useMessageStore } from '~/store/messageStore'
import type { Conversation } from '~/types/api/conversation'

interface Props {
  initialConversations: Conversation[]
  total: number
}

const CONVERSATION_LIST_POLL_INTERVAL_MS = 15_000

export const ConversationList = ({ initialConversations, total }: Props) => {
  const [conversations, setConversations] =
    useState<Conversation[]>(initialConversations)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const isMounted = useMounted()
  const setHasUnreadConversation = useMessageStore(
    (state) => state.setHasUnreadConversation
  )
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const syncConversationUnreadStatus = useCallback(
    (items: Conversation[]) => {
      if (items.some((conv) => conv.unreadCount > 0)) {
        setHasUnreadConversation(true)
      }
    },
    [setHasUnreadConversation]
  )

  const fetchConversations = useCallback(
    async (options: { showLoading: boolean; silent: boolean }) => {
      if (options.showLoading) {
        setLoading(true)
      }

      try {
        const response = await kunFetchGet<
          KunResponse<{
            conversations: Conversation[]
            total: number
          }>
        >('/message/conversation', {
          page,
          limit: 30
        })
        if (typeof response === 'string') {
          if (!options.silent) {
            toast.error(response)
          }
        } else {
          setConversations(response.conversations)
          syncConversationUnreadStatus(response.conversations)
        }
      } catch {
        if (!options.silent) {
          toast.error('获取会话列表失败, 请稍后重试')
        }
      } finally {
        if (options.showLoading) {
          setLoading(false)
        }
      }
    },
    [page, syncConversationUnreadStatus]
  )

  const clearPollTimer = useCallback(() => {
    if (!pollTimerRef.current) {
      return
    }

    clearTimeout(pollTimerRef.current)
    pollTimerRef.current = null
  }, [])

  useEffect(() => {
    if (!isMounted) {
      return
    }
    void fetchConversations({ showLoading: true, silent: false })
  }, [fetchConversations, isMounted])

  useEffect(() => {
    syncConversationUnreadStatus(initialConversations)
  }, [initialConversations, syncConversationUnreadStatus])

  useEffect(() => {
    if (!isMounted) {
      return
    }

    let ignore = false

    const pollConversations = async () => {
      if (document.visibilityState !== 'hidden') {
        await fetchConversations({ showLoading: false, silent: true })
      }

      if (!ignore) {
        clearPollTimer()
        pollTimerRef.current = setTimeout(
          pollConversations,
          CONVERSATION_LIST_POLL_INTERVAL_MS
        )
      }
    }

    clearPollTimer()
    pollTimerRef.current = setTimeout(
      pollConversations,
      CONVERSATION_LIST_POLL_INTERVAL_MS
    )

    return () => {
      ignore = true
      clearPollTimer()
    }
  }, [clearPollTimer, fetchConversations, isMounted])

  return (
    <div className="space-y-4">
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

      {total > 30 && (
        <div className="flex justify-center">
          <KunPagination
            total={Math.ceil(total / 30)}
            page={page}
            onPageChange={setPage}
            isLoading={loading}
          />
        </div>
      )}
    </div>
  )
}
