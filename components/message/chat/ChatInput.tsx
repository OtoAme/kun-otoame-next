'use client'

import { useRef, useState } from 'react'
import { Button } from '@heroui/react'
import { Textarea } from '@heroui/input'
import { ImageIcon, Plus, Send, X } from 'lucide-react'
import { kunFetchPost } from '~/utils/kunFetch'
import toast from 'react-hot-toast'
import { ChatAttachmentMenu } from './ChatAttachmentMenu'
import type {
  PrivateMessage,
  PrivateMessageImage
} from '~/types/api/conversation'

interface Props {
  conversationId: number
  replyTarget?: PrivateMessage
  replySelectedText?: string | null
  onCancelReply?: () => void
  onMessageSent: (message: PrivateMessage) => void
}

export const ChatInput = ({
  conversationId,
  replyTarget,
  replySelectedText,
  onCancelReply,
  onMessageSent
}: Props) => {
  const [content, setContent] = useState('')
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false)
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [uploadedImage, setUploadedImage] = useState<PrivateMessageImage | null>(
    null
  )
  const [sending, setSending] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isComposingRef = useRef(false)
  const isSendingRef = useRef(false)

  const handleSend = async () => {
    if (isSendingRef.current) {
      return
    }

    const trimmedContent = content.trim()
    if (!trimmedContent && !selectedImage && !uploadedImage) {
      return
    }

    if (trimmedContent.length > 2000) {
      toast.error('消息内容最多 2000 个字符')
      return
    }

    isSendingRef.current = true
    setSending(true)
    try {
      let imagePayload = uploadedImage
      if (selectedImage && !imagePayload) {
        const formData = new FormData()
        formData.append('image', selectedImage)
        const uploadResponse = await kunFetchPost<
          KunResponse<PrivateMessageImage>
        >(`/message/conversation/${conversationId}/image`, formData)

        if (typeof uploadResponse === 'string') {
          toast.error(uploadResponse)
          return
        }
        imagePayload = uploadResponse
        setUploadedImage(uploadResponse)
      }

      const response = await kunFetchPost<KunResponse<PrivateMessage>>(
        `/message/conversation/${conversationId}`,
        {
          type: imagePayload ? 1 : 0,
          content: trimmedContent,
          image: imagePayload ?? undefined,
          replyToMessageId: replyTarget?.id,
          replySelectedText: replySelectedText ?? undefined
        }
      )

      if (typeof response === 'string') {
        toast.error(response)
      } else {
        setContent('')
        setSelectedImage(null)
        setUploadedImage(null)
        onCancelReply?.()
        onMessageSent(response)
      }
    } finally {
      isSendingRef.current = false
      setSending(false)
    }
  }

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    setSelectedImage(file)
    setUploadedImage(null)
    setIsAttachmentMenuOpen(false)
  }

  const removeSelectedImage = () => {
    setSelectedImage(null)
    setUploadedImage(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const canSend = Boolean(content.trim() || selectedImage || uploadedImage)

  const insertNewline = (target: HTMLTextAreaElement) => {
    const start = target.selectionStart
    const end = target.selectionEnd
    const newContent = content.slice(0, start) + '\n' + content.slice(end)
    setContent(newContent)
    setTimeout(() => {
      target.selectionStart = target.selectionEnd = start + 1
    }, 0)
  }

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    if (e.key === 'Enter') {
      if (isComposingRef.current || e.nativeEvent.isComposing) {
        return
      }

      if (e.shiftKey || e.ctrlKey) {
        e.preventDefault()
        insertNewline(e.currentTarget as HTMLTextAreaElement)
      } else {
        e.preventDefault()
        handleSend()
      }
    }
  }

  return (
    <div>
      {replyTarget && (
        <div className="mb-2 flex items-center justify-between rounded-lg border-l-3 border-primary bg-primary-50/70 px-3 py-2 text-sm dark:bg-primary-500/10">
          <div className="min-w-0">
            <div className="font-medium text-primary">
              {replyTarget.sender.name}
            </div>
            <div className="truncate text-default-500">
              {replySelectedText || replyTarget.content || '[图片]'}
            </div>
          </div>
          <Button
            isIconOnly
            size="sm"
            variant="light"
            aria-label="取消回复"
            onPress={onCancelReply}
          >
            ×
          </Button>
        </div>
      )}

      {selectedImage && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-default-100 px-3 py-2 text-sm">
          <ImageIcon className="size-4 text-default-500" />
          <span className="min-w-0 flex-1 truncate">{selectedImage.name}</span>
          <Button
            isIconOnly
            size="sm"
            variant="light"
            aria-label="移除图片"
            onPress={removeSelectedImage}
          >
            <X className="size-4" />
          </Button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="relative">
          <Button
            isIconOnly
            variant={isAttachmentMenuOpen ? 'flat' : 'light'}
            aria-label="添加附件"
            onPress={() => setIsAttachmentMenuOpen((value) => !value)}
          >
            <Plus className="size-4" />
          </Button>
          <ChatAttachmentMenu
            isOpen={isAttachmentMenuOpen}
            onPickImage={() => fileInputRef.current?.click()}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            className="hidden"
            onChange={handleImageChange}
          />
        </div>
        <Textarea
          placeholder="输入消息... (按 Enter 发送，Shift+Enter 换行)"
          value={content}
          onValueChange={setContent}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => {
            isComposingRef.current = true
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false
          }}
          minRows={1}
          maxRows={5}
          classNames={{
            inputWrapper: 'bg-default-100'
          }}
        />
        <Button
          color="primary"
          isIconOnly
          isLoading={sending}
          isDisabled={!canSend}
          aria-label="发送消息"
          onPress={handleSend}
        >
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  )
}
