'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '~/utils/cn'
import { formatTimeDifference } from '~/utils/time'
import { KunAvatar } from '~/components/kun/floating-card/KunAvatar'
import { ChatImageGrid } from './ChatImageGrid'
import { ChatReplyPreview } from './ChatReplyPreview'
import { Button } from '@heroui/react'
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure
} from '@heroui/modal'
import { Textarea } from '@heroui/input'
import {
  Check,
  CheckCheck,
  Copy,
  Image as ImageIcon,
  Pencil,
  Reply,
  TextQuote,
  Trash2
} from 'lucide-react'
import { kunFetchPut, kunFetchDelete } from '~/utils/kunFetch'
import toast from 'react-hot-toast'
import type {
  PrivateMessage,
  PrivateMessageImage,
  PrivateMessageReplyPreview
} from '~/types/api/conversation'

type MessageUpdateData =
  | { action: 'delete' }
  | { action: 'edit'; content: string; editedAt: string | Date }

export type ChatReplyHighlight =
  | { messageId: number; kind: 'bubble' }
  | { messageId: number; kind: 'text'; selectedText: string }
  | { messageId: number; kind: 'image'; image: PrivateMessageImage }

interface Props {
  message: PrivateMessage
  isOwn: boolean
  conversationId: number
  onReply?: (
    message: PrivateMessage,
    selectedText: string | null,
    imageIndex?: number | null
  ) => void
  onOpenImage?: (message: PrivateMessage, imageIndex: number) => void
  onReplyPreviewClick?: (
    replyTo: PrivateMessageReplyPreview,
    sourceMessageId: number
  ) => void
  replyHighlight?: ChatReplyHighlight | null
  isReplyHighlightFading?: boolean
  onMessageUpdated: (data: MessageUpdateData) => void
}

interface MessageMenuState {
  id: number
  x: number
  y: number
  selectedText: string
  imageIndex?: number
  openedByKeyboard?: boolean
}

const MENU_WIDTH = 180
const MENU_ITEM_HEIGHT = 40
const SWIPE_REPLY_DIRECTION_LOCK_DISTANCE = 10
const SWIPE_REPLY_DIRECTION_RATIO = 1.25
const SWIPE_REPLY_TRIGGER_DISTANCE = 56
const SWIPE_REPLY_MAX_OFFSET = 72
const bubbleTransition = {
  type: 'spring' as const,
  stiffness: 520,
  damping: 36
}
export const ChatMessage = ({
  message,
  isOwn,
  conversationId,
  onReply,
  onOpenImage,
  onReplyPreviewClick,
  replyHighlight,
  isReplyHighlightFading,
  onMessageUpdated
}: Props) => {
  const [menu, setMenu] = useState<MessageMenuState | null>(null)
  const [isMenuReady, setIsMenuReady] = useState(false)
  const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure()
  const {
    isOpen: isDeleteConfirmOpen,
    onOpen: onOpenDeleteConfirm,
    onOpenChange: onDeleteConfirmOpenChange,
    onClose: onCloseDeleteConfirm
  } = useDisclosure()
  const [editContent, setEditContent] = useState(message.content)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [swipeReplyOffset, setSwipeReplyOffset] = useState(0)
  const [isSwipeReplyReady, setIsSwipeReplyReady] = useState(false)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLSpanElement>(null)
  const editTextareaRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuOpenIdRef = useRef(0)
  const touchStartRef = useRef<{
    x: number
    y: number
    time: number
    pointerId: number
    isHorizontalSwipe: boolean
    startedOnImage: boolean
    startedImageIndex?: number
  } | null>(null)
  const lastPointerTypeRef = useRef<React.PointerEvent['pointerType'] | ''>('')
  const suppressAvatarClickRef = useRef(false)
  const suppressAvatarClickTimerRef = useRef<number | null>(null)
  const messageImages =
    message.images && message.images.length > 0
      ? message.images
      : message.image
        ? [message.image]
        : []
  const hasImages = messageImages.length > 0
  const isSingleImage = messageImages.length === 1
  const hasCaption = Boolean(message.content.trim())
  const activeReplyHighlight =
    replyHighlight?.messageId === message.id ? replyHighlight : null
  const isActiveReplyHighlightFading = Boolean(
    activeReplyHighlight && isReplyHighlightFading
  )
  const highlightedText =
    activeReplyHighlight?.kind === 'text'
      ? activeReplyHighlight.selectedText
      : null
  const trimmedHighlightedText = highlightedText?.trim() ?? ''
  const isFullTextHighlight =
    Boolean(trimmedHighlightedText) &&
    trimmedHighlightedText === message.content.trim()
  const rawHighlightedTextStart =
    highlightedText && !isFullTextHighlight
      ? message.content.indexOf(highlightedText)
      : -1
  const trimmedHighlightedTextStart =
    trimmedHighlightedText && !isFullTextHighlight
      ? message.content.indexOf(trimmedHighlightedText)
      : -1
  const displayedHighlightedText =
    rawHighlightedTextStart >= 0
      ? (highlightedText ?? '')
      : trimmedHighlightedText
  const highlightedTextStart =
    rawHighlightedTextStart >= 0
      ? rawHighlightedTextStart
      : trimmedHighlightedTextStart
  const hasTextHighlight =
    Boolean(displayedHighlightedText) && highlightedTextStart >= 0
  const highlightedImageIndex =
    activeReplyHighlight?.kind === 'image'
      ? messageImages.findIndex(
          (image) => image.url === activeReplyHighlight.image.url
        )
      : -1
  const isBubbleHighlighted =
    activeReplyHighlight?.kind === 'bubble' ||
    Boolean(activeReplyHighlight?.kind === 'image' && highlightedImageIndex < 0)

  const closeMessageMenu = () => {
    setIsMenuReady(false)
    setMenu(null)
  }

  const resetSwipeReplyState = () => {
    setSwipeReplyOffset(0)
    setIsSwipeReplyReady(false)
  }

  const clearAvatarClickSuppression = () => {
    suppressAvatarClickRef.current = false
    if (suppressAvatarClickTimerRef.current) {
      window.clearTimeout(suppressAvatarClickTimerRef.current)
      suppressAvatarClickTimerRef.current = null
    }
  }

  const getSelectedTextInMessage = () => {
    const selection = window.getSelection()
    const contentElement = contentRef.current

    if (
      !selection ||
      !contentElement ||
      selection.isCollapsed ||
      selection.rangeCount === 0
    ) {
      return ''
    }

    const range = selection.getRangeAt(0)
    if (!range.intersectsNode(contentElement)) {
      return ''
    }

    try {
      const contentRange = document.createRange()
      contentRange.selectNodeContents(contentElement)

      const selectedRange = range.cloneRange()
      if (
        selectedRange.compareBoundaryPoints(
          Range.START_TO_START,
          contentRange
        ) < 0
      ) {
        selectedRange.setStart(
          contentRange.startContainer,
          contentRange.startOffset
        )
      }
      if (
        selectedRange.compareBoundaryPoints(Range.END_TO_END, contentRange) > 0
      ) {
        selectedRange.setEnd(contentRange.endContainer, contentRange.endOffset)
      }

      const selectedText = selectedRange.toString()
      return selectedText.trim() ? selectedText : ''
    } catch {
      const selectedText = selection.toString()
      return selectedText.trim() ? selectedText : ''
    }
  }

  const getMenuItemCount = (selectedText: string) => {
    const hasCopyableText = Boolean(selectedText || hasCaption)

    return (
      1 +
      (selectedText ? 1 : 0) +
      (hasImages ? 1 : 0) +
      (hasCopyableText ? 1 : 0) +
      (isOwn && hasCaption ? 1 : 0) +
      (isOwn ? 1 : 0)
    )
  }

  const openMessageMenu = (
    x: number,
    y: number,
    options: { imageIndex?: number; openedByKeyboard?: boolean } = {}
  ) => {
    if (message.isDeleted) {
      return
    }

    setIsMenuReady(false)

    const selectedText = getSelectedTextInMessage()
    const itemCount = getMenuItemCount(selectedText)
    const menuHeight = itemCount * MENU_ITEM_HEIGHT + 8
    const nextX = Math.min(Math.max(8, x), window.innerWidth - MENU_WIDTH - 8)
    const nextY = Math.min(Math.max(8, y), window.innerHeight - menuHeight - 8)

    setMenu({
      id: ++menuOpenIdRef.current,
      x: nextX,
      y: nextY,
      selectedText,
      imageIndex: options.imageIndex,
      openedByKeyboard: options.openedByKeyboard
    })
  }

  const openKeyboardMessageMenu = () => {
    const rect = bubbleRef.current?.getBoundingClientRect()
    const x = rect ? rect.left + Math.min(32, Math.max(16, rect.width / 2)) : 32
    const y = rect ? rect.top + Math.min(40, Math.max(16, rect.height)) : 32

    openMessageMenu(x, y, { openedByKeyboard: true })
  }

  const copyToClipboard = async (text: string, successMessage = '复制成功') => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(successMessage)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'fixed'
      textarea.style.left = '-9999px'
      document.body.appendChild(textarea)
      textarea.select()

      const copied = document.execCommand('copy')
      document.body.removeChild(textarea)

      if (copied) {
        toast.success(successMessage)
      } else {
        toast.error('复制失败! 请更换更现代的浏览器!')
      }
    }
  }

  const copyImageToClipboard = async (imageIndex = 0) => {
    const image = messageImages[imageIndex] ?? messageImages[0]
    if (!image) {
      return
    }

    await copyToClipboard(image.url, '图片链接已复制')
  }

  const handleEdit = async () => {
    if (!editContent.trim()) {
      toast.error('消息内容不能为空')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await kunFetchPut<
        KunResponse<{ id: number; content: string; editedAt: string }>
      >(`/message/conversation/${conversationId}`, {
        messageId: message.id,
        content: editContent.trim()
      })

      if (typeof response === 'string') {
        toast.error(response)
      } else {
        toast.success('消息已编辑')
        onClose()
        onMessageUpdated({
          action: 'edit',
          content: response.content,
          editedAt: response.editedAt
        })
      }
    } catch {
      toast.error('消息编辑失败，请稍后重试')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    setIsSubmitting(true)
    try {
      const response = await kunFetchDelete<KunResponse<{}>>(
        `/message/conversation/${conversationId}`,
        { messageId: message.id }
      )

      if (typeof response === 'string') {
        toast.error(response)
      } else {
        toast.success('消息已删除')
        onCloseDeleteConfirm()
        onMessageUpdated({ action: 'delete' })
      }
    } catch {
      toast.error('消息删除失败，请稍后重试')
    } finally {
      setIsSubmitting(false)
    }
  }

  const openDeleteConfirmModal = () => {
    if (!isMenuReady) {
      return
    }

    closeMessageMenu()
    onOpenDeleteConfirm()
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    if (lastPointerTypeRef.current && lastPointerTypeRef.current !== 'mouse') {
      return
    }

    e.preventDefault()
    openMessageMenu(e.clientX, e.clientY)
  }

  const handleImageContextMenu = (
    imageIndex: number,
    e: React.MouseEvent<HTMLButtonElement>
  ) => {
    if (lastPointerTypeRef.current && lastPointerTypeRef.current !== 'mouse') {
      return
    }

    e.preventDefault()
    e.stopPropagation()
    openMessageMenu(e.clientX, e.clientY, { imageIndex })
  }

  const handleBubbleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const shouldOpenMenu =
      e.key === 'Enter' ||
      e.key === ' ' ||
      e.key === 'Spacebar' ||
      e.key === 'ContextMenu' ||
      (e.key === 'F10' && e.shiftKey)

    if (!shouldOpenMenu) {
      return
    }

    e.preventDefault()
    e.stopPropagation()
    openKeyboardMessageMenu()
  }

  const handlePointerDown = (
    e: React.PointerEvent,
    options: { startedOnImage?: boolean; startedImageIndex?: number } = {}
  ) => {
    lastPointerTypeRef.current = e.pointerType

    if (menu && e.button !== 2) {
      closeMessageMenu()
      touchStartRef.current = null
      resetSwipeReplyState()
      return
    }

    if (e.pointerType === 'mouse' || !e.isPrimary) {
      touchStartRef.current = null
      resetSwipeReplyState()
      return
    }

    touchStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      time: Date.now(),
      pointerId: e.pointerId,
      isHorizontalSwipe: false,
      startedOnImage: Boolean(options.startedOnImage),
      startedImageIndex: options.startedImageIndex
    }
    resetSwipeReplyState()
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' || !e.isPrimary) {
      return
    }

    const start = touchStartRef.current
    if (!start || start.pointerId !== e.pointerId) {
      return
    }

    const deltaX = e.clientX - start.x
    const deltaY = e.clientY - start.y
    const absX = Math.abs(deltaX)
    const absY = Math.abs(deltaY)

    if (
      !start.isHorizontalSwipe &&
      absX < SWIPE_REPLY_DIRECTION_LOCK_DISTANCE &&
      absY < SWIPE_REPLY_DIRECTION_LOCK_DISTANCE
    ) {
      return
    }

    const isLeftSwipe =
      deltaX < 0 && absX >= absY * SWIPE_REPLY_DIRECTION_RATIO
    if (!start.isHorizontalSwipe && !isLeftSwipe) {
      resetSwipeReplyState()
      return
    }

    start.isHorizontalSwipe = true
    e.preventDefault()
    window.getSelection()?.removeAllRanges()

    const nextOffset = Math.max(-SWIPE_REPLY_MAX_OFFSET, Math.min(0, deltaX))
    setSwipeReplyOffset(nextOffset)
    setIsSwipeReplyReady(Math.abs(nextOffset) >= SWIPE_REPLY_TRIGGER_DISTANCE)
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' || !e.isPrimary) {
      return
    }

    const start = touchStartRef.current
    touchStartRef.current = null
    if (!start || start.pointerId !== e.pointerId) {
      resetSwipeReplyState()
      return
    }

    const deltaX = e.clientX - start.x
    const deltaY = e.clientY - start.y
    const absX = Math.abs(deltaX)
    const absY = Math.abs(deltaY)
    const shouldReplyFromSwipe =
      start.isHorizontalSwipe &&
      deltaX < 0 &&
      absX >= SWIPE_REPLY_TRIGGER_DISTANCE &&
      absX >= absY * SWIPE_REPLY_DIRECTION_RATIO

    resetSwipeReplyState()

    if (shouldReplyFromSwipe) {
      e.preventDefault()
      if (start.startedImageIndex === undefined) {
        onReply?.(message, null)
      } else {
        onReply?.(message, null, start.startedImageIndex)
      }
      return
    }

    const distance = Math.hypot(e.clientX - start.x, e.clientY - start.y)
    const duration = Date.now() - start.time
    if (distance > 10 || duration > 500) {
      return
    }
    if (start.startedOnImage) {
      return
    }

    openMessageMenu(e.clientX, e.clientY)
  }

  const handlePointerCancel = (e: React.PointerEvent) => {
    if (touchStartRef.current?.pointerId === e.pointerId) {
      touchStartRef.current = null
    }
    resetSwipeReplyState()
  }

  const handleImagePointerDown = (
    imageIndex: number,
    e: React.PointerEvent<HTMLButtonElement>
  ) => {
    handlePointerDown(e, {
      startedOnImage: true,
      startedImageIndex: imageIndex
    })
  }

  const handleImagePointerMove = (
    _imageIndex: number,
    e: React.PointerEvent<HTMLButtonElement>
  ) => {
    handlePointerMove(e)
  }

  const handleImagePointerUp = (
    _imageIndex: number,
    e: React.PointerEvent<HTMLButtonElement>
  ) => {
    handlePointerUp(e)
  }

  const handleImagePointerCancel = (
    _imageIndex: number,
    e: React.PointerEvent<HTMLButtonElement>
  ) => {
    handlePointerCancel(e)
  }

  const handleCopy = async () => {
    if (!menu || !isMenuReady) {
      return
    }

    const textToCopy = menu.selectedText || message.content
    if (!textToCopy.trim()) {
      return
    }

    await copyToClipboard(textToCopy)
    closeMessageMenu()
  }

  const handleCopyImage = async () => {
    if (!menu || !isMenuReady) {
      return
    }

    await copyImageToClipboard(menu.imageIndex ?? 0)
    closeMessageMenu()
  }

  const openEditModal = () => {
    if (!isMenuReady || !hasCaption) {
      return
    }

    closeMessageMenu()
    setEditContent(message.content)
    onOpen()
  }

  const moveEditCaretToEnd = (
    textControl: HTMLInputElement | HTMLTextAreaElement
  ) => {
    const end = textControl.value.length
    textControl.setSelectionRange(end, end)
  }

  const handleReply = (selectedText: string | null) => {
    if (!menu || !isMenuReady) {
      return
    }

    closeMessageMenu()
    const replyImageIndex =
      selectedText === null && menu.imageIndex !== undefined
        ? menu.imageIndex
        : undefined

    if (replyImageIndex === undefined) {
      onReply?.(message, selectedText)
    } else {
      onReply?.(message, selectedText, replyImageIndex)
    }
  }

  const handleAvatarPointerDownCapture = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    if (!menu) {
      return
    }

    e.preventDefault()
    e.stopPropagation()
    closeMessageMenu()
    suppressAvatarClickRef.current = true

    if (suppressAvatarClickTimerRef.current) {
      window.clearTimeout(suppressAvatarClickTimerRef.current)
    }
    suppressAvatarClickTimerRef.current = window.setTimeout(
      clearAvatarClickSuppression,
      400
    )
  }

  const handleAvatarClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!suppressAvatarClickRef.current && !menu) {
      return
    }

    e.preventDefault()
    e.stopPropagation()
    closeMessageMenu()
    clearAvatarClickSuppression()
  }

  useEffect(() => {
    if (!menu) {
      return
    }

    const closeIfOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (
        menuRef.current?.contains(target) ||
        bubbleRef.current?.contains(target)
      ) {
        return
      }
      closeMessageMenu()
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMessageMenu()
      }
    }
    const closeMenu = () => closeMessageMenu()

    document.addEventListener('pointerdown', closeIfOutside)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)

    return () => {
      document.removeEventListener('pointerdown', closeIfOutside)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [menu])

  useEffect(() => {
    if (!menu?.openedByKeyboard || !isMenuReady) {
      return
    }

    menuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      ?.focus({ preventScroll: true })
  }, [menu, isMenuReady])

  useEffect(() => {
    return () => {
      if (suppressAvatarClickTimerRef.current) {
        window.clearTimeout(suppressAvatarClickTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const textarea = editTextareaRef.current
    if (!textarea) {
      return
    }

    textarea.focus({ preventScroll: true })
    moveEditCaretToEnd(textarea)
  }, [isOpen])

  if (message.isDeleted) {
    return (
      <div
        id={`chat-message-${message.id}`}
        className={cn(
          'flex items-end gap-3 mb-4',
          isOwn ? 'flex-row-reverse' : 'flex-row'
        )}
      >
        <div
          className="shrink-0 select-none"
          onPointerDownCapture={handleAvatarPointerDownCapture}
          onClickCapture={handleAvatarClickCapture}
        >
          <KunAvatar
            uid={message.sender.id}
            avatarProps={{
              src: message.sender.avatar,
              name: message.sender.name,
              className: 'shrink-0 select-none'
            }}
          />
        </div>
        <div className="max-w-[70%] select-none rounded-2xl bg-[var(--kun-chat-deleted-bg)] px-4 py-2">
          <p className="text-sm italic text-[var(--kun-chat-muted-text)]">
            {message.sender.name} 删除了一条消息
          </p>
        </div>
      </div>
    )
  }

  const isImageOnly = hasImages && !hasCaption && !message.replyTo
  const shouldShrinkWrapImage = hasImages && isSingleImage && !hasCaption
  const hasImageWithTextOrReply = hasImages && !isImageOnly
  const bubbleWidthClassName =
    'max-w-full md:max-w-[min(60vw,42rem)]'
  const imageBubbleWidthClassName = shouldShrinkWrapImage
    ? 'w-fit max-w-full md:max-w-[min(60vw,42rem)]'
    : 'w-full max-w-full md:w-[min(60vw,32rem)] md:max-w-[min(60vw,42rem)]'
  const bubblePaddingClassName = isImageOnly ? 'p-0.5' : 'px-2.5 py-1'

  const renderReplyPreview = () => {
    if (!message.replyTo) {
      return null
    }

    return (
      <ChatReplyPreview
        senderName={message.replyTo.senderName}
        content={message.replyTo.content}
        selectedText={message.replyTo.selectedText}
        image={message.replyTo.image}
        onClick={
          onReplyPreviewClick
            ? () => onReplyPreviewClick(message.replyTo!, message.id)
            : undefined
        }
        className={cn(
          'mb-1 border-[var(--kun-chat-own-bubble-border)] bg-[var(--kun-chat-reply-bg)] py-1 pl-3.5 pr-2 text-[13px] text-[var(--kun-chat-reply-text)]',
          isOwn
            ? 'border-[var(--kun-chat-own-bubble-border)] bg-[var(--kun-chat-own-reply-bg)] text-[var(--kun-chat-own-reply-text)]'
            : ''
        )}
        titleClassName="text-[var(--kun-chat-reply-title)]"
      />
    )
  }

  const renderMessageText = () => {
    if (!message.content) {
      return null
    }

    return renderMessageTextRange(0, message.content.length)
  }

  const renderHighlightMark = (text: string) => (
    <mark
      data-testid="chat-reply-text-highlight"
      className={cn(
        'rounded bg-[var(--kun-chat-highlight-bg)] px-0.5 text-inherit ring-1 ring-[var(--kun-chat-highlight-border)] transition-opacity duration-300',
        isActiveReplyHighlightFading ? 'opacity-0' : 'opacity-100'
      )}
    >
      {text}
    </mark>
  )

  const renderMessageTextRange = (start: number, end: number) => {
    const text = message.content.slice(start, end)
    if (!highlightedText || !hasTextHighlight) {
      return text
    }

    const highlightStart = highlightedTextStart
    const highlightEnd = highlightedTextStart + displayedHighlightedText.length
    const overlapStart = Math.max(start, highlightStart)
    const overlapEnd = Math.min(end, highlightEnd)
    if (overlapStart >= overlapEnd) {
      return text
    }

    return (
      <>
        {message.content.slice(start, overlapStart)}
        {renderHighlightMark(message.content.slice(overlapStart, overlapEnd))}
        {message.content.slice(overlapEnd, end)}
      </>
    )
  }

  const shouldRightAlignInlineMeta = !isImageOnly

  const renderMessageBody = () => (
    <>
      {renderReplyPreview()}
      {hasImages && (
        <ChatImageGrid
          images={messageImages}
          caption={message.content}
          singleImageVariant={isSingleImage && hasCaption ? 'framed' : 'fit'}
          activeImageIndex={
            menu?.imageIndex ??
            (highlightedImageIndex >= 0 ? highlightedImageIndex : null)
          }
          isActiveImageFading={
            highlightedImageIndex >= 0 && isActiveReplyHighlightFading
          }
          onImageContextMenu={handleImageContextMenu}
          onImagePointerDown={handleImagePointerDown}
          onImagePointerMove={handleImagePointerMove}
          onImagePointerUp={handleImagePointerUp}
          onImagePointerCancel={handleImagePointerCancel}
          onImageOpen={
            onOpenImage
              ? (imageIndex) => onOpenImage(message, imageIndex)
              : undefined
          }
          className={cn(
            isImageOnly && 'rounded-[1.05rem]',
            hasImageWithTextOrReply && '-mx-2 mb-1.5 rounded-xl'
          )}
        />
      )}
      {message.content ? (
        <p className="relative text-left text-sm leading-5 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          <span
            ref={contentRef}
            data-testid="chat-message-text"
            className="break-words [overflow-wrap:anywhere]"
          >
            {renderMessageText()}
          </span>
          {shouldRightAlignInlineMeta ? (
            <span
              data-testid="chat-message-meta-line"
              className="inline align-bottom"
            >
              <span
                data-testid="chat-message-meta-spacer"
                aria-hidden="true"
                className="invisible ml-2 inline-flex h-0 select-none items-center gap-1 overflow-hidden whitespace-nowrap text-[10px] align-baseline"
              >
                {metaContentMarkup}
              </span>
              {renderMessageMeta('inline-right')}
            </span>
          ) : (
            renderMessageMeta('inline')
          )}
        </p>
      ) : (
        !isImageOnly && (
          <div className="flex justify-end leading-4">
            {renderMessageMeta('standalone')}
          </div>
        )
      )}
    </>
  )

  const bubbleHighlightMarkup = isBubbleHighlighted ? (
    <span
      data-testid="chat-reply-bubble-highlight"
      className={cn(
        'pointer-events-none absolute inset-0 z-30 rounded-2xl bg-[var(--kun-chat-highlight-bg)] ring-2 ring-inset ring-[var(--kun-chat-highlight-border)] transition-opacity duration-300',
        isActiveReplyHighlightFading ? 'opacity-0' : 'opacity-100'
      )}
    />
  ) : null

  const readLabel = message.status === 1 ? '已读' : '未读'
  const StatusIcon = message.status === 1 ? CheckCheck : Check
  const statusMarkup = isOwn ? (
    <span
      className="inline-flex items-center justify-end"
      aria-label={readLabel}
      title={readLabel}
    >
      <StatusIcon className="size-3" />
    </span>
  ) : null
  const metaContentMarkup = (
    <>
      <span>{formatTimeDifference(message.created)}</span>
      {message.editedAt && <span>(已编辑)</span>}
      {statusMarkup}
    </>
  )
  const renderMessageMeta = (
    variant: 'inline' | 'inline-right' | 'standalone' | 'overlay'
  ) => (
    <span
      data-testid="chat-message-meta"
      className={cn(
        'inline-flex select-none items-center gap-1 whitespace-nowrap text-[10px] leading-4',
        variant === 'overlay'
          ? 'pointer-events-none absolute bottom-1.5 right-1.5 z-20 rounded-full bg-black/45 px-2 py-0.5 text-white shadow-sm backdrop-blur-sm'
          : isOwn
            ? 'text-[var(--kun-chat-own-meta-text)]'
            : 'text-[var(--kun-chat-other-meta-text)]',
        variant === 'inline' && 'ml-2 align-bottom pb-px',
        variant === 'inline-right' &&
          'pointer-events-none absolute bottom-0 right-0 shrink-0 justify-end text-right align-bottom pb-px',
        variant === 'standalone' && 'mt-0.5'
      )}
    >
      {metaContentMarkup}
    </span>
  )
  const bubbleMenuLabel = isOwn
    ? '打开我的消息操作菜单'
    : `打开 ${message.sender.name} 的消息操作菜单`
  const bubbleInteractionProps = {
    tabIndex: 0,
    role: 'button',
    'aria-label': bubbleMenuLabel,
    'aria-haspopup': 'menu' as const,
    'aria-expanded': Boolean(menu),
    onKeyDown: handleBubbleKeyDown
  }
  const swipeReplyIndicatorMarkup = (
    <span
      data-testid="chat-swipe-reply-indicator"
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute right-0 top-1/2 z-40 flex size-9 shrink-0 -translate-y-1/2 translate-x-[calc(100%+0.5rem)] items-center justify-center rounded-full bg-[hsl(var(--kun-brand-500)/0.92)] text-white shadow-lg transition-[opacity,transform,background-color,box-shadow] duration-150',
        swipeReplyOffset < -SWIPE_REPLY_DIRECTION_LOCK_DISTANCE
          ? 'scale-100 opacity-100'
          : 'scale-90 opacity-0',
        isSwipeReplyReady &&
          'bg-[hsl(var(--kun-brand-600))] shadow-[0_0_0_3px_hsl(var(--kun-brand-500)/0.18),0_10px_24px_hsl(var(--kun-brand-600)/0.28)]'
      )}
    >
      <Reply className="size-4" />
    </span>
  )

  return (
    <>
      <motion.div
        id={`chat-message-${message.id}`}
        className={cn(
          'relative mb-4 flex w-fit max-w-full min-w-0 items-end gap-3 overflow-visible [touch-action:pan-y]',
          isOwn ? 'ml-auto flex-row-reverse' : 'mr-auto flex-row'
        )}
        animate={{ x: swipeReplyOffset }}
        transition={bubbleTransition}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <div
          className="shrink-0 select-none"
          onPointerDownCapture={handleAvatarPointerDownCapture}
          onClickCapture={handleAvatarClickCapture}
        >
          <KunAvatar
            uid={message.sender.id}
            avatarProps={{
              src: message.sender.avatar,
              name: message.sender.name,
              className: 'shrink-0 select-none'
            }}
          />
        </div>

        {isOwn ? (
          <motion.div
            ref={bubbleRef}
            data-testid="chat-message-bubble"
            className={cn(
              'relative min-w-0 max-w-full select-text rounded-2xl bg-[var(--kun-chat-own-bubble-bg)] text-[var(--kun-chat-own-bubble-text)] shadow-sm ring-1 ring-[var(--kun-chat-own-bubble-border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--kun-brand-500)/0.55)]',
              hasImages ? imageBubbleWidthClassName : bubbleWidthClassName,
              bubblePaddingClassName,
              menu &&
                'shadow-lg ring-2 ring-[var(--kun-chat-own-bubble-active-border)]'
            )}
            animate={{
              scale: menu ? 0.985 : 1,
              y: menu ? -1 : 0
            }}
            transition={bubbleTransition}
            onContextMenu={handleContextMenu}
            {...bubbleInteractionProps}
          >
            <div className={cn(isImageOnly && 'relative')}>
              {renderMessageBody()}
              {isImageOnly && renderMessageMeta('overlay')}
            </div>
            {bubbleHighlightMarkup}
          </motion.div>
        ) : (
          <motion.div
            ref={bubbleRef}
            data-testid="chat-message-bubble"
            className={cn(
              'relative min-w-0 max-w-full select-text rounded-2xl bg-[var(--kun-chat-other-bubble-bg)] text-[var(--kun-chat-other-bubble-text)] shadow-sm ring-1 ring-[var(--kun-chat-other-bubble-border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--kun-brand-500)/0.55)]',
              hasImages ? imageBubbleWidthClassName : bubbleWidthClassName,
              bubblePaddingClassName,
              menu &&
                'shadow-lg ring-2 ring-[var(--kun-chat-other-bubble-active-border)]'
            )}
            animate={{
              scale: menu ? 0.985 : 1,
              y: menu ? -1 : 0
            }}
            transition={bubbleTransition}
            onContextMenu={handleContextMenu}
            {...bubbleInteractionProps}
          >
            <div className={cn(isImageOnly && 'relative')}>
              {renderMessageBody()}
              {isImageOnly && renderMessageMeta('overlay')}
            </div>
            {bubbleHighlightMarkup}
          </motion.div>
        )}
        {swipeReplyIndicatorMarkup}
      </motion.div>

      <AnimatePresence>
        {menu && (
          <motion.div
            key={menu.id}
            ref={menuRef}
            className={cn(
              'fixed z-50 w-[180px] origin-top-left overflow-hidden rounded-xl border border-[var(--kun-chat-menu-border)] bg-[var(--kun-chat-menu-bg)] p-1 text-sm text-[var(--kun-chat-menu-text)] shadow-2xl backdrop-blur-md',
              !isMenuReady && 'pointer-events-none'
            )}
            role="menu"
            aria-busy={!isMenuReady}
            style={{ left: menu.x, top: menu.y }}
            initial={{ opacity: 0, scale: 0.86, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: -6 }}
            transition={{ type: 'spring', stiffness: 520, damping: 34 }}
            onAnimationComplete={() => setIsMenuReady(true)}
            onContextMenu={(e) => e.preventDefault()}
          >
            <motion.button
              className="flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left outline-none transition-colors hover:bg-[var(--kun-chat-menu-item-hover-bg)] focus:bg-[var(--kun-chat-menu-item-hover-bg)]"
              role="menuitem"
              type="button"
              disabled={!isMenuReady}
              aria-disabled={!isMenuReady}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.03 }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleReply(null)}
            >
              <Reply className="size-4" />
              回复
            </motion.button>

            {menu.selectedText && (
              <motion.button
                className="flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left outline-none transition-colors hover:bg-[var(--kun-chat-menu-item-hover-bg)] focus:bg-[var(--kun-chat-menu-item-hover-bg)]"
                role="menuitem"
                type="button"
                disabled={!isMenuReady}
                aria-disabled={!isMenuReady}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.045 }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleReply(menu.selectedText)}
              >
                <TextQuote className="size-4" />
                回复选中文本
              </motion.button>
            )}

            {hasImages && (
              <motion.button
                className="flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left outline-none transition-colors hover:bg-[var(--kun-chat-menu-item-hover-bg)] focus:bg-[var(--kun-chat-menu-item-hover-bg)]"
                role="menuitem"
                type="button"
                disabled={!isMenuReady}
                aria-disabled={!isMenuReady}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.06 }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleCopyImage}
              >
                <ImageIcon className="size-4" />
                复制图片链接
              </motion.button>
            )}

            {(menu.selectedText || hasCaption) && (
              <motion.button
                className="flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left outline-none transition-colors hover:bg-[var(--kun-chat-menu-item-hover-bg)] focus:bg-[var(--kun-chat-menu-item-hover-bg)]"
                role="menuitem"
                type="button"
                disabled={!isMenuReady}
                aria-disabled={!isMenuReady}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: hasImages ? 0.075 : 0.06 }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleCopy}
              >
                <Copy className="size-4" />
                {menu.selectedText ? '复制选中文本' : '复制文本'}
              </motion.button>
            )}

            {isOwn && hasCaption && (
              <motion.button
                className="flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left outline-none transition-colors hover:bg-[var(--kun-chat-menu-item-hover-bg)] focus:bg-[var(--kun-chat-menu-item-hover-bg)]"
                role="menuitem"
                type="button"
                disabled={!isMenuReady}
                aria-disabled={!isMenuReady}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.09 }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={openEditModal}
              >
                <Pencil className="size-4" />
                编辑
              </motion.button>
            )}

            {isOwn && (
              <motion.button
                className="flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-danger outline-none transition-colors hover:bg-danger-50 focus:bg-danger-50 dark:hover:bg-danger-50/10 dark:focus:bg-danger-50/10"
                role="menuitem"
                type="button"
                disabled={!isMenuReady}
                aria-disabled={!isMenuReady}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.12 }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={openDeleteConfirmModal}
              >
                <Trash2 className="size-4" />
                删除
              </motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <Modal isOpen={isOpen} onOpenChange={onOpenChange} placement="top">
        <ModalContent>
          <ModalHeader>编辑消息</ModalHeader>
          <ModalBody>
            <Textarea
              ref={editTextareaRef}
              value={editContent}
              onValueChange={setEditContent}
              onFocus={(event) => moveEditCaretToEnd(event.currentTarget)}
              autoFocus
              minRows={2}
              maxRows={10}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onClose}>
              取消
            </Button>
            <Button
              color="primary"
              isLoading={isSubmitting}
              onPress={handleEdit}
            >
              保存
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        isOpen={isDeleteConfirmOpen}
        onOpenChange={onDeleteConfirmOpenChange}
        placement="center"
      >
        <ModalContent>
          <ModalHeader>确认删除消息</ModalHeader>
          <ModalBody>
            <p>确定要删除这条消息吗？</p>
            <p className="text-sm text-[var(--kun-chat-muted-text)]">
              删除后对话中会显示为已删除消息，原正文和图片内容不会继续展示。
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="light"
              onPress={onCloseDeleteConfirm}
              isDisabled={isSubmitting}
            >
              取消
            </Button>
            <Button
              color="danger"
              isLoading={isSubmitting}
              isDisabled={isSubmitting}
              onPress={handleDelete}
            >
              确认删除
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
