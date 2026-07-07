'use client'

import { useState } from 'react'
import { useRouter } from '@bprogress/next'
import { Button } from '@heroui/button'
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  useDisclosure
} from '@heroui/modal'
import { Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { kunFetchDelete } from '~/utils/kunFetch'

interface Props {
  conversationId: number
  otherUserName: string
}

export const DeleteConversationButton = ({
  conversationId,
  otherUserName
}: Props) => {
  const router = useRouter()
  const { isOpen, onOpen, onClose, onOpenChange } = useDisclosure()
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDeleteConversation = async () => {
    setIsDeleting(true)
    try {
      const response = await kunFetchDelete<KunResponse<{}>>(
        `/message/conversation/${conversationId}`,
        { action: 'conversation' }
      )

      if (typeof response === 'string') {
        toast.error(response)
        return
      }

      toast.success('私聊已从列表移除')
      onClose()
      router.push('/message/chat')
    } catch {
      toast.error('移除私聊失败，请稍后重试')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <>
      <Button
        variant="light"
        color="danger"
        size="sm"
        isIconOnly
        aria-label="移除该私聊"
        onPress={onOpen}
      >
        <Trash2 className="size-4" />
      </Button>

      <Modal isOpen={isOpen} onOpenChange={onOpenChange} placement="center">
        <ModalContent>
          <ModalHeader>移除私聊</ModalHeader>
          <ModalBody>
            <p>确定要从你的列表移除与 {otherUserName} 的私聊吗？</p>
            <p className="text-sm text-[var(--kun-chat-muted-text)]">
              这只会隐藏你这边的会话列表记录，不会删除对方的私聊内容。再次发起或收到新消息后，会话会重新出现。
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onClose} isDisabled={isDeleting}>
              取消
            </Button>
            <Button
              color="danger"
              onPress={handleDeleteConversation}
              isLoading={isDeleting}
              isDisabled={isDeleting}
            >
              移除
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
