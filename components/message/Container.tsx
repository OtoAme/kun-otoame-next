'use client'

import { useEffect, useRef, useState } from 'react'
import { useMounted } from '~/hooks/useMounted'
import { KunLoading } from '~/components/kun/Loading'
import { MessageCard } from './MessageCard'
import { kunFetchDelete, kunFetchGet } from '~/utils/kunFetch'
import { KunNull } from '~/components/kun/Null'
import { MESSAGE_TYPE } from '~/constants/message'
import toast from 'react-hot-toast'
import { KunPagination } from '~/components/kun/Pagination'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  useDisclosure
} from '@heroui/react'
import { Trash2 } from 'lucide-react'
import type { Message } from '~/types/api/message'

interface Props {
  initialMessages: Message[]
  total: number
  type?: (typeof MESSAGE_TYPE)[number]
}

export const MessageContainer = ({ initialMessages, total, type }: Props) => {
  const currentType = type ?? ''
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [messageTotal, setMessageTotal] = useState(total)
  const [loading, setLoading] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [page, setPage] = useState(1)
  const isMounted = useMounted()
  const hasUsedInitialPageRef = useRef(false)
  const requestIdRef = useRef(0)
  const { isOpen, onOpen, onClose, onOpenChange } = useDisclosure()

  const fetchMessages = async (
    targetPage: number,
    options: { showLoading: boolean } = { showLoading: true }
  ) => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    try {
      if (options.showLoading) {
        setLoading(true)
      }

      const response = await kunFetchGet<
        KunResponse<{
          messages: Message[]
          total: number
        }>
      >('/message/all', {
        ...(currentType ? { type: currentType } : {}),
        page: targetPage,
        limit: 30
      })

      if (requestId !== requestIdRef.current) {
        return
      }

      if (typeof response === 'string') {
        toast.error(response)
      } else {
        setMessages(response.messages)
        setMessageTotal(response.total)
      }
    } catch {
      if (requestId === requestIdRef.current) {
        toast.error('获取消息失败, 请稍后重试')
      }
    } finally {
      if (requestId === requestIdRef.current && options.showLoading) {
        setLoading(false)
      }
    }
  }

  const handleClearReadMessages = async () => {
    try {
      setClearing(true)

      const response = await kunFetchDelete<KunResponse<{}>>('/message/read', {
        type: currentType
      })
      if (typeof response === 'string') {
        toast.error(response)
        return
      }

      toast.success('已清理已读信息')
      onClose()

      if (page !== 1) {
        setPage(1)
      } else {
        await fetchMessages(1)
      }
    } catch {
      toast.error('清理已读信息失败, 请稍后重试')
    } finally {
      setClearing(false)
    }
  }

  useEffect(() => {
    if (!isMounted) {
      return
    }
    if (!hasUsedInitialPageRef.current) {
      hasUsedInitialPageRef.current = true
      void fetchMessages(page, { showLoading: false })
      return
    }
    void fetchMessages(page)
  }, [isMounted, page])

  return (
    <div className="space-y-4">
      <Button
        color="danger"
        variant="flat"
        startContent={<Trash2 className="size-4" />}
        isDisabled={loading || clearing || !messageTotal}
        isLoading={clearing}
        onPress={onOpen}
        fullWidth
      >
        清理已读信息
      </Button>

      <Modal isOpen={isOpen} onOpenChange={onOpenChange} placement="center">
        <ModalContent>
          <ModalHeader>确认清理已读信息</ModalHeader>
          <ModalBody>
            <p>确定要清理当前分类下的已读消息吗？</p>
            <p className="text-sm text-default-500">
              未读消息会被保留，清理后的已读消息不会再出现在消息列表中。
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onClose} isDisabled={clearing}>
              取消
            </Button>
            <Button
              color="danger"
              onPress={handleClearReadMessages}
              isLoading={clearing}
              isDisabled={clearing}
            >
              确认清理
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {loading ? (
        <KunLoading hint="正在获取消息数据..." />
      ) : !messages.length ? (
        <KunNull message="暂无消息" />
      ) : (
        <div className="space-y-4">
          {messages.map((msg) => (
            <MessageCard key={msg.id} msg={msg} />
          ))}
        </div>
      )}

      {messageTotal > 30 && (
        <div className="flex justify-center">
          <KunPagination
            total={Math.ceil(messageTotal / 30)}
            page={page}
            onPageChange={setPage}
            isLoading={loading}
          />
        </div>
      )}
    </div>
  )
}
