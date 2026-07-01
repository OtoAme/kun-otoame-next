'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@heroui/react'
import { Textarea } from '@heroui/input'
import { ImageIcon, Plus, Send, X } from 'lucide-react'
import { kunFetchFormData, kunFetchPost } from '~/utils/kunFetch'
import toast from 'react-hot-toast'
import { ChatAttachmentMenu } from './ChatAttachmentMenu'
import { ChatReplyPreview } from './ChatReplyPreview'
import { KunImageViewer } from '~/components/kun/image-viewer/ImageViewer'
import type {
  PrivateMessage,
  PrivateMessageImage
} from '~/types/api/conversation'

interface Props {
  conversationId: number
  replyTarget?: PrivateMessage
  replySelectedText?: string | null
  replyImageIndex?: number | null
  onCancelReply?: () => void
  onMessageSent: (message: PrivateMessage) => void
}

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif'
])
const MAX_IMAGES_PER_MESSAGE = 9

export const ChatInput = ({
  conversationId,
  replyTarget,
  replySelectedText,
  replyImageIndex,
  onCancelReply,
  onMessageSent
}: Props) => {
  const [content, setContent] = useState('')
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false)
  const [selectedImages, setSelectedImages] = useState<File[]>([])
  const [uploadedImages, setUploadedImages] = useState<
    (PrivateMessageImage | null)[]
  >([])
  const [previewImages, setPreviewImages] = useState<PrivateMessageImage[]>([])
  const [sending, setSending] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const attachmentMenuRef = useRef<HTMLDivElement>(null)
  const isComposingRef = useRef(false)
  const isSendingRef = useRef(false)

  useEffect(() => {
    const previews = selectedImages.map((file) => ({
      url: URL.createObjectURL(file),
      width: 1,
      height: 1,
      size: file.size,
      mime: file.type,
      name: file.name
    }))

    setPreviewImages(previews)

    return () => {
      previews.forEach((preview) => URL.revokeObjectURL(preview.url))
    }
  }, [selectedImages])

  useEffect(() => {
    if (!isAttachmentMenuOpen) {
      return
    }

    const closeIfOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (attachmentMenuRef.current?.contains(target)) {
        return
      }
      setIsAttachmentMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsAttachmentMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', closeIfOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeIfOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isAttachmentMenuOpen])

  useEffect(() => {
    if (!replyTarget) {
      return
    }

    const textarea = textareaRef.current
    if (!textarea) {
      return
    }

    const end = textarea.value.length
    textarea.focus({ preventScroll: true })
    textarea.setSelectionRange(end, end)
  }, [replyImageIndex, replySelectedText, replyTarget])

  const isUploadedImage = (
    image: PrivateMessageImage | null | undefined
  ): image is PrivateMessageImage => Boolean(image)

  const handleSend = async () => {
    if (isSendingRef.current) {
      return
    }

    const trimmedContent = content.trim()
    if (
      !trimmedContent &&
      selectedImages.length === 0 &&
      uploadedImages.length === 0
    ) {
      return
    }

    if (trimmedContent.length > 2000) {
      toast.error('消息内容最多 2000 个字符')
      return
    }

    isSendingRef.current = true
    setSending(true)
    try {
      let imagePayloads = uploadedImages.filter(isUploadedImage)
      if (selectedImages.length > 0) {
        const nextUploadedImages = selectedImages.map(
          (_, index) => uploadedImages[index] ?? null
        )
        const pendingUploads = selectedImages
          .map((file, index) => ({ file, index }))
          .filter(({ index }) => !nextUploadedImages[index])

        if (pendingUploads.length > 0) {
          const uploadResults = await Promise.allSettled(
            pendingUploads.map(async ({ file, index }) => {
              const formData = new FormData()
              formData.append('image', file)
              const result = await kunFetchFormData<
                KunResponse<PrivateMessageImage>
              >(`/message/conversation/${conversationId}/image`, formData)
              return { index, result }
            })
          )

          let failedUpload: string | null = null
          for (const uploadResult of uploadResults) {
            if (uploadResult.status === 'rejected') {
              failedUpload ??= '图片上传失败，请重试'
              continue
            }

            const { index, result } = uploadResult.value
            if (typeof result === 'string') {
              failedUpload ??= result
            } else {
              nextUploadedImages[index] = result
            }
          }

          setUploadedImages(nextUploadedImages)

          if (failedUpload) {
            toast.error(failedUpload)
            return
          }
        }

        imagePayloads = nextUploadedImages.filter(isUploadedImage)
        if (imagePayloads.length !== selectedImages.length) {
          toast.error('图片上传失败，请重试')
          return
        }
      }

      const response = await kunFetchPost<KunResponse<PrivateMessage>>(
        `/message/conversation/${conversationId}`,
        {
          type: imagePayloads.length > 0 ? 1 : 0,
          content: trimmedContent,
          image: imagePayloads[0] ?? undefined,
          images: imagePayloads.length > 0 ? imagePayloads : undefined,
          replyToMessageId: replyTarget?.id,
          replySelectedText: replySelectedText ?? undefined,
          replyImageIndex: replyImageIndex ?? undefined
        }
      )

      if (typeof response === 'string') {
        toast.error(response)
      } else {
        setContent('')
        setSelectedImages([])
        setUploadedImages([])
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
        onCancelReply?.()
        onMessageSent(response)
      }
    } catch {
      toast.error('消息发送失败，请稍后重试')
    } finally {
      isSendingRef.current = false
      setSending(false)
    }
  }

  const appendImages = (files: File[]) => {
    const images = files.filter((file) => ALLOWED_IMAGE_TYPES.has(file.type))
    if (images.length === 0) {
      return
    }

    setSelectedImages((current) => {
      const remainingSlots = Math.max(
        0,
        MAX_IMAGES_PER_MESSAGE - current.length
      )
      const imagesToAppend = images.slice(0, remainingSlots)
      if (imagesToAppend.length < images.length) {
        toast.error('一次最多发送 9 张图片')
      }
      if (imagesToAppend.length === 0) {
        return current
      }
      return [...current, ...imagesToAppend]
    })
    setIsAttachmentMenuOpen(false)
  }

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    appendImages(Array.from(event.target.files ?? []))
  }

  const handlePaste = (
    event: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const directFiles = Array.from(event.clipboardData.files).filter((file) =>
      ALLOWED_IMAGE_TYPES.has(file.type)
    )
    const itemFiles =
      directFiles.length > 0
        ? []
        : Array.from(event.clipboardData.items)
            .map((item) => (item.kind === 'file' ? item.getAsFile() : null))
            .filter(
              (file): file is File =>
                file !== null && ALLOWED_IMAGE_TYPES.has(file.type)
            )
    const files = directFiles.length > 0 ? directFiles : itemFiles

    if (files.length === 0) {
      return
    }

    event.preventDefault()
    appendImages(files)
  }

  const removeSelectedImage = (index?: number) => {
    setSelectedImages((current) =>
      index === undefined
        ? []
        : current.filter((_, itemIndex) => itemIndex !== index)
    )
    setUploadedImages((current) =>
      index === undefined
        ? []
        : current.filter((_, itemIndex) => itemIndex !== index)
    )
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const canSend = Boolean(
    content.trim() || selectedImages.length > 0 || uploadedImages.length > 0
  )
  const previewViewerImages = previewImages.map((image) => ({
    src: image.url,
    alt: image.name || '待发送图片',
    width: image.width,
    height: image.height
  }))
  const replyTargetImages =
    replyTarget?.images && replyTarget.images.length > 0
      ? replyTarget.images
      : replyTarget?.image
        ? [replyTarget.image]
        : []
  const replyImage =
    replyImageIndex === null || replyImageIndex === undefined
      ? null
      : (replyTargetImages[replyImageIndex] ?? null)

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
        <div className="mb-3 flex items-center gap-3">
          <ChatReplyPreview
            senderName={replyTarget.sender.name}
            actionLabel="回复"
            content={replyTarget.content}
            selectedText={replySelectedText}
            image={replyImage}
            className="min-w-0 flex-1 rounded-md border-[hsl(var(--kun-brand-500))] bg-[hsl(var(--kun-brand-50)/0.62)] py-1 pl-3.5 pr-2 text-default-600 dark:bg-[hsl(var(--kun-brand-500)/0.1)] dark:text-default-300"
            titleClassName="text-[hsl(var(--kun-brand-600))] dark:text-[hsl(var(--kun-brand-500))]"
          />
          <Button
            isIconOnly
            size="sm"
            variant="light"
            aria-label="取消回复"
            onPress={onCancelReply}
          >
            <X className="size-4" />
          </Button>
        </div>
      )}

      {previewImages.length > 0 && (
        <div className="mb-2 rounded-2xl border border-[hsl(var(--kun-brand-100)/0.85)] bg-[hsl(var(--kun-brand-50)/0.55)] p-1.5 shadow-sm dark:border-[hsl(var(--kun-brand-400)/0.18)] dark:bg-[hsl(var(--kun-brand-500)/0.08)]">
          <KunImageViewer images={previewViewerImages} preload={2}>
            {(openLightbox) => (
              <div className="grid max-w-sm grid-cols-2 gap-1 overflow-hidden rounded-xl">
                {previewImages.map((image, index) => (
                  <div
                    key={`${image.url}-${index}`}
                    className="relative aspect-square min-h-0 min-w-0 overflow-hidden bg-default-100"
                  >
                    <button
                      type="button"
                      className="group block h-full w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--kun-brand-500))]"
                      aria-label={`查看待发送图片 ${index + 1}`}
                      onClick={() => openLightbox(index)}
                    >
                      <img
                        src={image.url}
                        alt={image.name || '待发送图片'}
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.015]"
                      />
                    </button>
                    <Button
                      isIconOnly
                      size="sm"
                      variant="flat"
                      aria-label={`移除第 ${index + 1} 张图片`}
                      className="absolute right-1 top-1 z-10 min-h-7 min-w-7 bg-background/85 text-default-700 shadow-sm backdrop-blur"
                      onPress={() => removeSelectedImage(index)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </KunImageViewer>
          <div className="mt-1.5 flex items-center justify-between gap-2 px-1 text-xs text-default-500">
            <span className="inline-flex min-w-0 items-center gap-1">
              <ImageIcon className="size-3.5 shrink-0" />
              <span className="truncate">
                {previewImages.length === 1
                  ? previewImages[0].name
                  : `${previewImages.length} 张图片`}
              </span>
            </span>
            <Button
              isIconOnly
              size="sm"
              variant="light"
              aria-label="移除图片"
              onPress={() => removeSelectedImage()}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-end gap-2">
        <div ref={attachmentMenuRef} className="relative">
          <Button
            isIconOnly
            variant={isAttachmentMenuOpen ? 'flat' : 'light'}
            aria-label="添加附件"
            aria-expanded={isAttachmentMenuOpen}
            aria-haspopup="menu"
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
            multiple
            accept="image/jpeg,image/png,image/webp,image/avif"
            className="hidden"
            onChange={handleImageChange}
          />
        </div>
        <Textarea
          ref={textareaRef}
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
          onPaste={handlePaste}
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
