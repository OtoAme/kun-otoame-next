'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '~/utils/cn'
import { formatTimeDifference } from '~/utils/time'
import { KunAvatar } from '~/components/kun/floating-card/KunAvatar'
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
import { Copy, Pencil, Trash2 } from 'lucide-react'
import { kunFetchPut, kunFetchDelete } from '~/utils/kunFetch'
import toast from 'react-hot-toast'
import type { PrivateMessage } from '~/types/api/conversation'

type MessageUpdateData =
  | { action: 'delete' }
  | { action: 'edit'; content: string; editedAt: string | Date }

interface Props {
  message: PrivateMessage
  isOwn: boolean
  conversationId: number
  onMessageUpdated: (data: MessageUpdateData) => void
}

interface MessageMenuState {
  id: number
  x: number
  y: number
  selectedText: string
}

const MENU_WIDTH = 180
const MENU_ITEM_HEIGHT = 40
const bubbleTransition = {
  type: 'spring' as const,
  stiffness: 520,
  damping: 36
}

export const ChatMessage = ({
  message,
  isOwn,
  conversationId,
  onMessageUpdated
}: Props) => {
  const [menu, setMenu] = useState<MessageMenuState | null>(null)
  const [isMenuReady, setIsMenuReady] = useState(false)
  const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure()
  const [editContent, setEditContent] = useState(message.content)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLParagraphElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuOpenIdRef = useRef(0)
  const touchStartRef = useRef<{
    x: number
    y: number
    time: number
    pointerId: number
  } | null>(null)
  const lastPointerTypeRef = useRef<React.PointerEvent['pointerType'] | ''>('')
  const suppressAvatarClickRef = useRef(false)
  const suppressAvatarClickTimerRef = useRef<number | null>(null)

  const closeMessageMenu = () => {
    setIsMenuReady(false)
    setMenu(null)
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

  const openMessageMenu = (x: number, y: number) => {
    if (message.isDeleted) {
      return
    }

    setIsMenuReady(false)

    const itemCount = isOwn ? 3 : 1
    const menuHeight = itemCount * MENU_ITEM_HEIGHT + 8
    const nextX = Math.min(Math.max(8, x), window.innerWidth - MENU_WIDTH - 8)
    const nextY = Math.min(Math.max(8, y), window.innerHeight - menuHeight - 8)

    setMenu({
      id: ++menuOpenIdRef.current,
      x: nextX,
      y: nextY,
      selectedText: getSelectedTextInMessage()
    })
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('复制成功')
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
        toast.success('复制成功')
      } else {
        toast.error('复制失败! 请更换更现代的浏览器!')
      }
    }
  }

  const handleEdit = async () => {
    if (!editContent.trim()) {
      toast.error('消息内容不能为空')
      return
    }

    setIsSubmitting(true)
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
    setIsSubmitting(false)
  }

  const handleDelete = async () => {
    if (menu && !isMenuReady) {
      return
    }

    closeMessageMenu()
    setIsSubmitting(true)
    const response = await kunFetchDelete<KunResponse<{}>>(
      `/message/conversation/${conversationId}`,
      { messageId: message.id }
    )

    if (typeof response === 'string') {
      toast.error(response)
    } else {
      toast.success('消息已删除')
      onMessageUpdated({ action: 'delete' })
    }
    setIsSubmitting(false)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    if (lastPointerTypeRef.current && lastPointerTypeRef.current !== 'mouse') {
      return
    }

    e.preventDefault()
    openMessageMenu(e.clientX, e.clientY)
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    lastPointerTypeRef.current = e.pointerType

    if (menu && e.button !== 2) {
      closeMessageMenu()
      touchStartRef.current = null
      return
    }

    if (e.pointerType === 'mouse' || !e.isPrimary) {
      touchStartRef.current = null
      return
    }

    touchStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      time: Date.now(),
      pointerId: e.pointerId
    }
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' || !e.isPrimary) {
      return
    }

    const start = touchStartRef.current
    touchStartRef.current = null
    if (!start || start.pointerId !== e.pointerId) {
      return
    }

    const distance = Math.hypot(e.clientX - start.x, e.clientY - start.y)
    const duration = Date.now() - start.time
    if (distance > 10 || duration > 500) {
      return
    }

    openMessageMenu(e.clientX, e.clientY)
  }

  const handleCopy = async () => {
    if (!menu || !isMenuReady) {
      return
    }

    await copyToClipboard(menu.selectedText || message.content)
    closeMessageMenu()
  }

  const openEditModal = () => {
    if (!isMenuReady) {
      return
    }

    closeMessageMenu()
    setEditContent(message.content)
    onOpen()
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

    const closeMenu = () => closeMessageMenu()

    document.addEventListener('pointerdown', closeIfOutside)
    document.addEventListener('keydown', closeMenu)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)

    return () => {
      document.removeEventListener('pointerdown', closeIfOutside)
      document.removeEventListener('keydown', closeMenu)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [menu])

  useEffect(() => {
    return () => {
      if (suppressAvatarClickTimerRef.current) {
        window.clearTimeout(suppressAvatarClickTimerRef.current)
      }
    }
  }, [])

  if (message.isDeleted) {
    return (
      <div
        className={cn(
          'flex gap-3 mb-4',
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
        <div className="max-w-[70%] select-none rounded-2xl bg-default-100 px-4 py-2 dark:bg-default-200">
          <p className="text-sm text-default-400 italic">
            {message.sender.name} 删除了一条消息
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div
        className={cn(
          'flex gap-3 mb-4',
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

        {isOwn ? (
          <motion.div
            ref={bubbleRef}
            className={cn(
              'max-w-[70%] select-text rounded-2xl bg-primary-500 px-4 py-2 text-white',
              menu && 'shadow-lg ring-2 ring-primary-200/70'
            )}
            animate={{
              scale: menu ? 0.985 : 1,
              y: menu ? -1 : 0
            }}
            transition={bubbleTransition}
            onContextMenu={handleContextMenu}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
          >
            <p
              ref={contentRef}
              className="whitespace-pre-wrap break-words text-sm"
            >
              {message.content}
            </p>
            <div className="mt-1 flex select-none items-center gap-2 text-xs text-primary-100">
              <span>{formatTimeDifference(message.created)}</span>
              {message.editedAt && <span>(已编辑)</span>}
            </div>
          </motion.div>
        ) : (
          <motion.div
            ref={bubbleRef}
            className={cn(
              'max-w-[70%] select-text rounded-2xl bg-default-100 px-4 py-2 dark:bg-default-200',
              menu && 'shadow-lg ring-2 ring-default-300/70'
            )}
            animate={{
              scale: menu ? 0.985 : 1,
              y: menu ? -1 : 0
            }}
            transition={bubbleTransition}
            onContextMenu={handleContextMenu}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
          >
            <p
              ref={contentRef}
              className="whitespace-pre-wrap break-words text-sm"
            >
              {message.content}
            </p>
            <div className="mt-1 flex select-none items-center gap-2 text-xs text-default-400">
              <span>{formatTimeDifference(message.created)}</span>
              {message.editedAt && <span>(已编辑)</span>}
            </div>
          </motion.div>
        )}
      </div>

      <AnimatePresence>
        {menu && (
          <motion.div
            key={menu.id}
            ref={menuRef}
            className={cn(
              'fixed z-50 w-[180px] origin-top-left overflow-hidden rounded-xl border border-default-200 bg-content1/95 p-1 text-sm shadow-2xl backdrop-blur-md',
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
              className="flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left outline-none transition-colors hover:bg-default-100 focus:bg-default-100"
              role="menuitem"
              type="button"
              disabled={!isMenuReady}
              aria-disabled={!isMenuReady}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.03 }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleCopy}
            >
              <Copy className="size-4" />
              {menu.selectedText ? '复制选中文本' : '复制文本'}
            </motion.button>

            {isOwn && (
              <>
                <motion.button
                  className="flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left outline-none transition-colors hover:bg-default-100 focus:bg-default-100"
                  role="menuitem"
                  type="button"
                  disabled={!isMenuReady}
                  aria-disabled={!isMenuReady}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.06 }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={openEditModal}
                >
                  <Pencil className="size-4" />
                  编辑
                </motion.button>

                <motion.button
                  className="flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-danger outline-none transition-colors hover:bg-danger-50 focus:bg-danger-50 dark:hover:bg-danger-50/10 dark:focus:bg-danger-50/10"
                  role="menuitem"
                  type="button"
                  disabled={!isMenuReady}
                  aria-disabled={!isMenuReady}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.09 }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={handleDelete}
                >
                  <Trash2 className="size-4" />
                  删除
                </motion.button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <Modal isOpen={isOpen} onOpenChange={onOpenChange} placement="top">
        <ModalContent>
          <ModalHeader>编辑消息</ModalHeader>
          <ModalBody>
            <Textarea
              value={editContent}
              onValueChange={setEditContent}
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
    </>
  )
}
