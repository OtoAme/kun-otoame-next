import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type {
  PrivateMessage,
  PrivateMessageReplyPreview
} from '~/types/api/conversation'
import type { ChatReplyHighlight } from '~/components/message/chat/ChatMessage'

globalThis.React = React

const imageViewerMock = vi.hoisted(() => ({
  images: [] as Array<{ src: string; alt?: string }>,
  openLightbox: vi.fn()
}))

vi.mock('framer-motion', () => {
  const MotionDiv = ({
    children,
    onAnimationComplete,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & {
    onAnimationComplete?: () => void
  }) => {
    React.useEffect(() => {
      onAnimationComplete?.()
    }, [onAnimationComplete])
    return <div {...props}>{children}</div>
  }

  const MotionButton = ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  )

  return {
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => (
      <>{children}</>
    ),
    motion: {
      div: MotionDiv,
      button: MotionButton
    }
  }
})

vi.mock('@heroui/react', () => ({
  Button: ({
    children,
    onPress,
    isLoading,
    isDisabled,
    isIconOnly: _isIconOnly,
    variant: _variant,
    color: _color,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    onPress?: () => void
    isLoading?: boolean
    isDisabled?: boolean
    isIconOnly?: boolean
    variant?: string
    color?: string
  }) => (
    <button
      {...props}
      disabled={props.disabled || isLoading || isDisabled}
      onClick={onPress}
    >
      {children}
    </button>
  )
}))

vi.mock('@heroui/modal', () => ({
  Modal: ({
    children,
    isOpen
  }: {
    children?: React.ReactNode
    isOpen?: boolean
  }) => (isOpen ? <div>{children}</div> : null),
  ModalContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalHeader: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalBody: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalFooter: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  useDisclosure: () => {
    const [isOpen, setIsOpen] = React.useState(false)

    return {
      isOpen,
      onOpen: () => setIsOpen(true),
      onOpenChange: setIsOpen,
      onClose: () => setIsOpen(false)
    }
  }
}))

vi.mock('@heroui/input', () => ({
  Textarea: React.forwardRef<
    HTMLTextAreaElement,
    {
      value?: string
      onValueChange?: (value: string) => void
      onFocus?: React.FocusEventHandler<HTMLTextAreaElement>
      autoFocus?: boolean
      minRows?: number
      maxRows?: number
    }
  >(
    (
      {
        value,
        onValueChange,
        onFocus,
        autoFocus,
        minRows: _minRows,
        maxRows: _maxRows,
        ...props
      },
      forwardedRef
    ) => {
      const ref = React.useRef<HTMLTextAreaElement>(null)
      React.useImperativeHandle(
        forwardedRef,
        () => ref.current as HTMLTextAreaElement
      )

      React.useEffect(() => {
        if (autoFocus && ref.current) {
          Object.defineProperty(ref.current.ownerDocument, 'activeElement', {
            configurable: true,
            get: () => ref.current
          })
          onFocus?.({
            currentTarget: ref.current,
            target: ref.current
          } as React.FocusEvent<HTMLTextAreaElement>)
        }
      }, [autoFocus, onFocus])

      return (
        <textarea
          aria-label="编辑消息内容"
          ref={ref}
          value={value}
          onChange={(event) => onValueChange?.(event.target.value)}
          onFocus={onFocus}
          {...props}
        />
      )
    }
  )
}))

vi.mock('~/components/kun/floating-card/KunAvatar', () => ({
  KunAvatar: () => <div data-testid="avatar" />
}))

vi.mock('~/components/kun/image-viewer/ImageViewer', () => ({
  KunImageViewer: ({
    images,
    children
  }: {
    images: Array<{ src: string; alt?: string }>
    children: (openLightbox: (index: number) => void) => React.ReactNode
  }) => {
    imageViewerMock.images = images
    return <>{children(imageViewerMock.openLightbox)}</>
  }
}))

vi.mock('~/utils/time', () => ({
  formatTimeDifference: () => '刚刚'
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchPut: vi.fn(),
  kunFetchDelete: vi.fn()
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

const baseMessage: PrivateMessage = {
  id: 3,
  type: 0,
  content: 'hello',
  status: 0,
  isDeleted: false,
  image: null,
  replyTo: null,
  editedAt: null,
  created: '2026-06-30T09:00:00.000Z',
  sender: { id: 8, name: 'Mio', avatar: '/mio.webp' }
}

describe('ChatMessage menu and rendering', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const renderMessage = async (
    message: PrivateMessage,
    options: {
      isOwn?: boolean
      onReply?: (
        message: PrivateMessage,
        selectedText: string | null,
        imageIndex?: number | null
      ) => void
      onReplyPreviewClick?: (
        replyTo: PrivateMessageReplyPreview,
        sourceMessageId: number
      ) => void
      replyHighlight?: ChatReplyHighlight | null
      isReplyHighlightFading?: boolean
    } = {}
  ) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('Range', dom.window.Range)
    Object.defineProperty(dom.window.HTMLElement.prototype, 'attachEvent', {
      configurable: true,
      value: vi.fn()
    })
    Object.defineProperty(dom.window.HTMLElement.prototype, 'detachEvent', {
      configurable: true,
      value: vi.fn()
    })
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { ChatMessage } = await import(
      '~/components/message/chat/ChatMessage'
    )
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(
        <ChatMessage
          message={message}
          isOwn={options.isOwn ?? false}
          conversationId={5}
          onReply={options.onReply ?? vi.fn()}
          onReplyPreviewClick={options.onReplyPreviewClick}
          replyHighlight={options.replyHighlight}
          isReplyHighlightFading={options.isReplyHighlightFading}
          onMessageUpdated={vi.fn()}
        />
      )
    })

    return { container: container!, onReply: options.onReply }
  }

  const openContextMenu = async (container: HTMLElement) => {
    const bubble = container.querySelector(
      '[data-testid="chat-message-bubble"]'
    )
    expect(bubble).not.toBeNull()

    await act(async () => {
      bubble!.dispatchEvent(
        new dom!.window.MouseEvent('contextmenu', {
          bubbles: true,
          clientX: 100,
          clientY: 100
        })
      )
      await Promise.resolve()
    })
  }

  const openTouchMenu = async (container: HTMLElement) => {
    const bubble = container.querySelector(
      '[data-testid="chat-message-bubble"]'
    )
    expect(bubble).not.toBeNull()

    const pointerDown = new dom!.window.MouseEvent('pointerdown', {
      bubbles: true,
      clientX: 80,
      clientY: 80
    })
    Object.defineProperties(pointerDown, {
      pointerType: { value: 'touch' },
      isPrimary: { value: true },
      pointerId: { value: 1 }
    })

    const pointerUp = new dom!.window.MouseEvent('pointerup', {
      bubbles: true,
      clientX: 82,
      clientY: 82
    })
    Object.defineProperties(pointerUp, {
      pointerType: { value: 'touch' },
      isPrimary: { value: true },
      pointerId: { value: 1 }
    })

    await act(async () => {
      bubble!.dispatchEvent(pointerDown)
      bubble!.dispatchEvent(pointerUp)
      await Promise.resolve()
    })
  }

  const swipeBubble = async (
    container: HTMLElement,
    points: Array<{ x: number; y: number }>
  ) => {
    const bubble = container.querySelector(
      '[data-testid="chat-message-bubble"]'
    )
    expect(bubble).not.toBeNull()
    expect(points.length).toBeGreaterThanOrEqual(2)

    const createTouchPointerEvent = (
      type: 'pointerdown' | 'pointermove' | 'pointerup',
      point: { x: number; y: number }
    ) => {
      const event = new dom!.window.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y
      })
      Object.defineProperties(event, {
        pointerType: { value: 'touch' },
        isPrimary: { value: true },
        pointerId: { value: 1 },
        button: { value: 0 }
      })

      return event
    }

    await act(async () => {
      bubble!.dispatchEvent(createTouchPointerEvent('pointerdown', points[0]))
      for (const point of points.slice(1, -1)) {
        bubble!.dispatchEvent(createTouchPointerEvent('pointermove', point))
      }
      bubble!.dispatchEvent(
        createTouchPointerEvent('pointerup', points[points.length - 1])
      )
      await Promise.resolve()
    })
  }

  const selectMessageText = (container: HTMLElement) => {
    const text = container.querySelector('p')
    expect(text).not.toBeNull()

    const range = dom!.window.document.createRange()
    range.selectNodeContents(text!)
    dom!.window.getSelection()?.removeAllRanges()
    dom!.window.getSelection()?.addRange(range)
  }

  const expectInlineMetaTailFlow = (container: HTMLElement) => {
    const paragraph = container.querySelector('p')
    const meta = container.querySelector('[data-testid="chat-message-meta"]')
    const metaLine = container.querySelector(
      '[data-testid="chat-message-meta-line"]'
    )
    const metaSpacer = container.querySelector(
      '[data-testid="chat-message-meta-spacer"]'
    )
    const text = container.querySelector('[data-testid="chat-message-text"]')
    const metaLineClasses = Array.from(metaLine?.classList ?? [])
    const metaClasses = Array.from(meta?.classList ?? [])
    const spacerClasses = Array.from(metaSpacer?.classList ?? [])

    expect(meta).not.toBeNull()
    expect(metaLine).not.toBeNull()
    expect(metaSpacer).not.toBeNull()
    expect(text?.nextElementSibling).toBe(metaLine)
    expect(metaLine?.parentElement).toBe(paragraph)
    expect(meta?.parentElement).toBe(metaLine)
    expect(metaSpacer?.nextElementSibling).toBe(meta)
    expect(paragraph?.className).not.toContain('grid')
    expect(paragraph?.className).not.toContain('items-end')
    expect(paragraph?.className).toContain('relative')
    expect(paragraph?.className).toContain('text-left')
    expect(paragraph?.className).toContain('whitespace-pre-wrap')
    expect(text?.className).toContain('break-words')
    expect(metaLineClasses).toContain('inline')
    expect(metaLineClasses).toContain('align-bottom')
    expect(metaLineClasses).not.toContain('inline-block')
    expect(metaLineClasses).not.toContain('inline-flex')
    expect(metaLineClasses).not.toContain('min-w-full')
    expect(metaLineClasses).not.toContain('w-full')
    expect(metaLineClasses).not.toContain('justify-between')
    expect(metaLineClasses).not.toContain('grid')
    expect(metaLine?.className).not.toContain('[text-align-last:justify]')
    expect(spacerClasses).toContain('invisible')
    expect(spacerClasses).toContain('inline-flex')
    expect(spacerClasses).toContain('h-0')
    expect(spacerClasses).toContain('overflow-hidden')
    expect(spacerClasses).toContain('whitespace-nowrap')
    expect(spacerClasses).toContain('align-baseline')
    expect(spacerClasses).not.toContain('leading-4')
    expect(spacerClasses).not.toContain('pb-px')
    expect(spacerClasses).not.toContain('w-[3.75rem]')
    expect(spacerClasses).not.toContain('w-[4.75rem]')
    expect(metaSpacer?.getAttribute('aria-hidden')).toBe('true')
    expect(metaSpacer?.textContent).toBe(meta?.textContent)
    expect(metaClasses).toContain('absolute')
    expect(metaClasses).toContain('bottom-0')
    expect(metaClasses).toContain('right-0')
    expect(metaClasses).toContain('justify-end')
    expect(metaClasses).toContain('text-right')
    expect(metaClasses).toContain('align-bottom')
    expect(metaClasses).not.toContain('self-end')
    expect(metaClasses).not.toContain('float-right')
    expect(metaClasses).not.toContain('mt-0.5')
    expect(meta?.textContent).toContain('刚刚')
    expect(meta?.querySelector('[aria-label="已读"]')).not.toBeNull()
  }

  beforeEach(() => {
    vi.resetModules()
    imageViewerMock.images = []
    imageViewerMock.openLightbox.mockReset()
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
  })

  it('shows reply action for a message context menu', async () => {
    const { container } = await renderMessage(baseMessage)

    await openContextMenu(container)

    expect(container.textContent).toContain('回复')
  })

  it('calls onReply when reply is clicked', async () => {
    const onReply = vi.fn()
    const { container } = await renderMessage(baseMessage, { onReply })

    await openContextMenu(container)
    const replyButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '回复'
    )
    expect(replyButton).toBeDefined()

    await act(async () => {
      replyButton!.click()
      await Promise.resolve()
    })

    expect(onReply).toHaveBeenCalledWith(baseMessage, null)
  })

  it('opens the same menu from a touch tap', async () => {
    const { container } = await renderMessage(baseMessage)

    await openTouchMenu(container)

    expect(container.textContent).toContain('回复')
  })

  it('replies directly when a mobile touch swipes the message left', async () => {
    const onReply = vi.fn()
    const { container } = await renderMessage(baseMessage, { onReply })

    await swipeBubble(container, [
      { x: 160, y: 120 },
      { x: 118, y: 121 },
      { x: 76, y: 122 }
    ])

    expect(onReply).toHaveBeenCalledWith(baseMessage, null)
    expect(container.querySelector('[role="menu"]')).toBeNull()
  })

  it('keeps the swipe reply icon outside the message bubble with row-level motion', async () => {
    const { container } = await renderMessage(baseMessage)

    const messageRow = container.querySelector<HTMLElement>('#chat-message-3')
    const bubble = container.querySelector<HTMLElement>(
      '[data-testid="chat-message-bubble"]'
    )
    const indicator = container.querySelector<HTMLElement>(
      '[data-testid="chat-swipe-reply-indicator"]'
    )

    expect(messageRow).not.toBeNull()
    expect(bubble).not.toBeNull()
    expect(indicator).not.toBeNull()
    expect(bubble?.parentElement).toBe(messageRow)
    expect(indicator?.parentElement).toBe(messageRow)
    expect(bubble?.contains(indicator)).toBe(false)
    expect(messageRow?.className).toContain('overflow-visible')
    expect(messageRow?.className).toContain('[touch-action:pan-y]')
    expect(messageRow?.className).toContain('w-fit')
    expect(indicator?.className).toContain('shrink-0')
    expect(indicator?.className).toContain('size-9')
    expect(indicator?.className).toContain('left-full')
    expect(indicator?.className).toContain('ml-2')
  })

  it('keeps vertical mobile drags available for scrolling', async () => {
    const onReply = vi.fn()
    const { container } = await renderMessage(baseMessage, { onReply })

    await swipeBubble(container, [
      { x: 160, y: 120 },
      { x: 156, y: 156 },
      { x: 154, y: 196 }
    ])

    expect(onReply).not.toHaveBeenCalled()
    expect(container.querySelector('[role="menu"]')).toBeNull()
  })

  it('opens the message menu from the focused bubble keyboard entry', async () => {
    const { container } = await renderMessage(baseMessage)
    const bubble = container.querySelector<HTMLElement>(
      '[data-testid="chat-message-bubble"]'
    )
    expect(bubble).not.toBeNull()

    expect(bubble!.tabIndex).toBe(0)
    expect(bubble!.getAttribute('aria-haspopup')).toBe('menu')

    await act(async () => {
      bubble!.focus()
      bubble!.dispatchEvent(
        new dom!.window.KeyboardEvent('keydown', {
          bubbles: true,
          key: 'Enter'
        })
      )
      await Promise.resolve()
    })

    expect(container.textContent).toContain('回复')
    expect(bubble!.getAttribute('aria-expanded')).toBe('true')
  })

  it('replies with selected text when text is selected', async () => {
    const onReply = vi.fn()
    const { container } = await renderMessage(baseMessage, { onReply })
    selectMessageText(container)

    await openContextMenu(container)
    const replySelectedButton = Array.from(
      container.querySelectorAll('button')
    ).find((button) => button.textContent === '回复选中文本')
    expect(replySelectedButton).toBeDefined()

    await act(async () => {
      replySelectedButton!.click()
      await Promise.resolve()
    })

    expect(onReply).toHaveBeenCalledWith(baseMessage, 'hello')
  })

  it('renders a read indicator for own read messages', async () => {
    const { container } = await renderMessage(
      {
        ...baseMessage,
        status: 1,
        sender: { id: 1007, name: 'Saya', avatar: '' }
      },
      { isOwn: true }
    )

    expect(container.textContent).not.toContain('已读')
    expect(container.querySelector('[aria-label="已读"]')).not.toBeNull()
  })

  it('places long text message metadata inline at the final text line end', async () => {
    const { container } = await renderMessage(
      {
        ...baseMessage,
        content:
          '非 upload API 先过 verifyKunCsrf，但两个只读匿名热点 /api/tag/otomegame 和 /api/company/otomegame 为降低 GET 固定开销从 matcher 中排除。',
        status: 1,
        sender: { id: 1007, name: 'Saya', avatar: '' }
      },
      { isOwn: true }
    )

    expectInlineMetaTailFlow(container)
  })

  it('keeps replied text message metadata in the same inline tail flow', async () => {
    const { container } = await renderMessage(
      {
        ...baseMessage,
        content:
          '这是一条带回复预览的正文，需要让时间和已读状态继续贴在最后一行右侧。',
        status: 1,
        replyTo: {
          messageId: 2,
          senderName: 'Mio',
          content: '原消息内容',
          selectedText: null,
          image: null
        },
        sender: { id: 1007, name: 'Saya', avatar: '' }
      },
      { isOwn: true }
    )

    expectInlineMetaTailFlow(container)
  })

  it('uses the regular text bubble style for short plain text messages', async () => {
    const { container } = await renderMessage(
      {
        ...baseMessage,
        content: 'ffyhb',
        status: 1,
        sender: { id: 1007, name: 'Saya', avatar: '' }
      },
      { isOwn: true }
    )

    const paragraph = container.querySelector('p')
    const bubble = container.querySelector(
      '[data-testid="chat-message-bubble"]'
    )
    const bubbleClasses = Array.from(bubble?.classList ?? [])
    const paragraphClasses = Array.from(paragraph?.classList ?? [])

    expectInlineMetaTailFlow(container)
    expect(bubbleClasses).toContain('py-1')
    expect(bubbleClasses).not.toContain('py-1.5')
    expect(paragraphClasses).toContain('leading-5')
    expect(paragraphClasses).not.toContain('leading-4')
    expect(bubble?.className).not.toContain('flex')
    expect(bubble?.className).not.toContain('items-center')
    expect(paragraph?.className).not.toContain('flex')
    expect(paragraph?.className).not.toContain('items-center')
    expect(paragraph?.className).not.toContain('justify-center')
    expect(paragraph?.className).not.toContain('text-center')
    expect(paragraph?.className).not.toContain('pr-16')
    expect(paragraph?.className).not.toContain('pl-16')
  })

  it('bottom-aligns the avatar with the chat bubble without stretching it', async () => {
    const { container } = await renderMessage(
      {
        ...baseMessage,
        content: '7654321',
        status: 1,
        sender: { id: 1007, name: 'Saya', avatar: '' }
      },
      { isOwn: true }
    )

    const messageRow = container.querySelector('#chat-message-3')
    const rowClasses = Array.from(messageRow?.classList ?? [])

    expect(messageRow).not.toBeNull()
    expect(rowClasses).toContain('flex')
    expect(rowClasses).toContain('items-end')
    expect(rowClasses).not.toContain('items-center')
  })

  it('wraps edited plain text messages with long continuous content', async () => {
    const { container } = await renderMessage(
      {
        ...baseMessage,
        content: '1534135333333333333333333嗷嗯嗷无头公案函数外',
        editedAt: '2026-07-01T09:00:00.000Z',
        status: 1,
        sender: { id: 1007, name: 'Saya', avatar: '' }
      },
      { isOwn: true }
    )

    const paragraph = container.querySelector('p')
    const text = container.querySelector('[data-testid="chat-message-text"]')
    const bubble = container.querySelector(
      '[data-testid="chat-message-bubble"]'
    )
    const bubbleClasses = Array.from(bubble?.classList ?? [])
    const paragraphClasses = Array.from(paragraph?.classList ?? [])
    const textClasses = Array.from(text?.classList ?? [])

    expectInlineMetaTailFlow(container)
    expect(container.textContent).toContain('(已编辑)')
    expect(bubbleClasses).toContain('min-w-0')
    expect(paragraphClasses).toContain('[overflow-wrap:anywhere]')
    expect(textClasses).toContain('[overflow-wrap:anywhere]')
  })

  it('uses a soft themed bubble for own messages', async () => {
    const { container } = await renderMessage(
      { ...baseMessage, sender: { id: 1007, name: 'Saya', avatar: '' } },
      { isOwn: true }
    )

    const bubble = container.querySelector(
      '[data-testid="chat-message-bubble"]'
    )
    expect(bubble?.className).toContain('bg-[hsl(var(--kun-brand-50)/0.96)]')
    expect(bubble?.className).toContain('md:max-w-[min(60vw,42rem)]')
    expect(bubble?.className).not.toContain('bg-primary-500')
  })

  it('focuses the edit textarea when editing a text message', async () => {
    const { container } = await renderMessage(
      {
        ...baseMessage,
        sender: { id: 1007, name: 'Saya', avatar: '' }
      },
      { isOwn: true }
    )

    await openContextMenu(container)
    const editButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '编辑'
    )
    expect(editButton).toBeDefined()

    await act(async () => {
      editButton!.click()
      await Promise.resolve()
    })

    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="编辑消息内容"]'
    )
    expect(textarea).not.toBeNull()
    expect(dom!.window.document.activeElement).toBe(textarea)
    expect(textarea!.selectionStart).toBe('hello'.length)
    expect(textarea!.selectionEnd).toBe('hello'.length)
  })

  it('releases the edit submit state after a request error', async () => {
    const { kunFetchPut } = await import('~/utils/kunFetch')
    const toast = (await import('react-hot-toast')).default
    let rejectEdit!: (error: Error) => void
    const editRequest = new Promise<never>((_, reject) => {
      rejectEdit = reject
    })
    vi.mocked(kunFetchPut).mockReturnValue(editRequest)

    const { container } = await renderMessage(
      {
        ...baseMessage,
        sender: { id: 1007, name: 'Saya', avatar: '' }
      },
      { isOwn: true }
    )

    await openContextMenu(container)
    const editButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '编辑'
    )
    expect(editButton).toBeDefined()

    await act(async () => {
      editButton!.click()
      await Promise.resolve()
    })

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '保存'
    )
    expect(saveButton).toBeDefined()

    await act(async () => {
      saveButton!.click()
      await Promise.resolve()
    })

    expect(saveButton!.disabled).toBe(true)

    await act(async () => {
      rejectEdit(new Error('offline'))
      await editRequest.catch(() => undefined)
      await Promise.resolve()
    })

    expect(toast.error).toHaveBeenCalledWith('消息编辑失败，请稍后重试')
    expect(saveButton!.disabled).toBe(false)
  })

  it('shows a retryable error when deleting a message request fails', async () => {
    const { kunFetchDelete } = await import('~/utils/kunFetch')
    const toast = (await import('react-hot-toast')).default
    let rejectDelete!: (error: Error) => void
    const deleteRequest = new Promise<never>((_, reject) => {
      rejectDelete = reject
    })
    vi.mocked(kunFetchDelete).mockReturnValue(deleteRequest)

    const { container } = await renderMessage(
      {
        ...baseMessage,
        sender: { id: 1007, name: 'Saya', avatar: '' }
      },
      { isOwn: true }
    )

    await openContextMenu(container)
    const deleteButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '删除'
    )
    expect(deleteButton).toBeDefined()

    await act(async () => {
      deleteButton!.click()
      await Promise.resolve()
    })

    const confirmButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '确认删除'
    )
    expect(confirmButton).toBeDefined()

    await act(async () => {
      confirmButton!.click()
      await Promise.resolve()
    })

    expect(confirmButton!.disabled).toBe(true)

    await act(async () => {
      rejectDelete(new Error('offline'))
      await deleteRequest.catch(() => undefined)
      await Promise.resolve()
    })

    expect(toast.error).toHaveBeenCalledWith('消息删除失败，请稍后重试')
    expect(confirmButton!.disabled).toBe(false)
  })

  it('asks for confirmation before deleting an own message', async () => {
    const { kunFetchDelete } = await import('~/utils/kunFetch')
    vi.mocked(kunFetchDelete).mockClear()
    vi.mocked(kunFetchDelete).mockResolvedValue({})

    const { container } = await renderMessage(
      {
        ...baseMessage,
        sender: { id: 1007, name: 'Saya', avatar: '' }
      },
      { isOwn: true }
    )

    await openContextMenu(container)
    const deleteButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '删除'
    )
    expect(deleteButton).toBeDefined()

    await act(async () => {
      deleteButton!.click()
      await Promise.resolve()
    })

    expect(kunFetchDelete).not.toHaveBeenCalled()
    expect(container.textContent).toContain('确认删除消息')

    const confirmButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '确认删除'
    )
    expect(confirmButton).toBeDefined()

    await act(async () => {
      confirmButton!.click()
      await Promise.resolve()
    })

    expect(kunFetchDelete).toHaveBeenCalledWith('/message/conversation/5', {
      messageId: 3
    })
  })

  it('renders image messages with alt text', async () => {
    const { container } = await renderMessage({
      ...baseMessage,
      type: 1,
      content: '',
      image: {
        url: 'https://img.example/chat.webp',
        width: 800,
        height: 600,
        size: 12345,
        mime: 'image/webp',
        name: 'chat.webp'
      }
    })

    const image = container.querySelector<HTMLImageElement>('img')
    expect(image?.src).toBe('https://img.example/chat.webp')
    expect(image?.alt).toBe('chat.webp')
    expect(image?.className).toContain('object-contain')
    expect(image?.className).not.toContain('object-cover')
    expect(
      container.querySelector('[data-testid="chat-message-bubble"]')?.className
    ).toContain('p-0.5')
    expect(
      container.querySelector('[data-testid="chat-message-bubble"]')?.className
    ).toContain('w-fit')
    expect(
      container
        .querySelector('button[aria-label="查看图片 1"]')
        ?.getAttribute('style')
    ).toContain('width:')
  })

  it('shows image-only message time and read indicator in a translucent bottom-right overlay', async () => {
    const { container } = await renderMessage(
      {
        ...baseMessage,
        type: 1,
        content: '',
        status: 1,
        image: {
          url: 'https://img.example/chat.webp',
          width: 800,
          height: 600,
          size: 12345,
          mime: 'image/webp',
          name: 'chat.webp'
        },
        sender: { id: 1007, name: 'Saya', avatar: '' }
      },
      { isOwn: true }
    )

    const meta = container.querySelector('[data-testid="chat-message-meta"]')

    expect(meta).not.toBeNull()
    expect(meta?.className).toContain('absolute')
    expect(meta?.className).toContain('bottom-1.5')
    expect(meta?.className).toContain('right-1.5')
    expect(meta?.className).toContain('bg-black/45')
    expect(meta?.textContent).toContain('刚刚')
    expect(meta?.querySelector('[aria-label="已读"]')).not.toBeNull()
  })

  it('keeps captioned image message metadata inline with the caption baseline', async () => {
    const { container } = await renderMessage(
      {
        ...baseMessage,
        type: 1,
        content: '回复图片试试',
        status: 1,
        image: {
          url: 'https://img.example/chat.webp',
          width: 800,
          height: 600,
          size: 12345,
          mime: 'image/webp',
          name: 'chat.webp'
        },
        replyTo: {
          messageId: 2,
          senderName: 'admin',
          content: '[图片]',
          selectedText: null,
          image: null
        },
        sender: { id: 1007, name: 'Saya', avatar: '' }
      },
      { isOwn: true }
    )

    const meta = container.querySelector('[data-testid="chat-message-meta"]')

    expectInlineMetaTailFlow(container)
    expect(container.querySelector('p')?.className).not.toContain('pr-20')
    expect(meta?.className).not.toContain('bg-black/45')
  })

  it('opens the message menu from an image context menu and copies the image link', async () => {
    const { container } = await renderMessage(
      {
        ...baseMessage,
        type: 1,
        content: '',
        image: {
          url: 'https://img.example/chat.webp',
          width: 800,
          height: 600,
          size: 12345,
          mime: 'image/webp',
          name: 'chat.webp'
        }
      },
      { isOwn: true }
    )
    const clipboardWriteText = vi.fn().mockResolvedValue(undefined)
    const fetchImage = vi.fn()
    Object.defineProperty(dom!.window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWriteText }
    })
    vi.stubGlobal('navigator', dom!.window.navigator)
    vi.stubGlobal('fetch', fetchImage)

    const imageButton = container.querySelector(
      'button[aria-label="查看图片 1"]'
    )
    expect(imageButton).not.toBeNull()

    await act(async () => {
      imageButton!.dispatchEvent(
        new dom!.window.MouseEvent('contextmenu', {
          bubbles: true,
          clientX: 100,
          clientY: 100
        })
      )
      await Promise.resolve()
    })

    expect(container.textContent).toContain('回复')
    expect(container.textContent).toContain('复制图片链接')
    expect(container.textContent).not.toContain('复制文本')
    expect(container.textContent).not.toContain('编辑')

    const copyImageButton = Array.from(
      container.querySelectorAll('button')
    ).find((button) => button.textContent === '复制图片链接')
    expect(copyImageButton).toBeDefined()

    await act(async () => {
      copyImageButton!.click()
      await Promise.resolve()
    })

    expect(clipboardWriteText).toHaveBeenCalledWith(
      'https://img.example/chat.webp'
    )
    expect(fetchImage).not.toHaveBeenCalled()
  })

  it('shows text copy when an image message has a caption', async () => {
    const { container } = await renderMessage({
      ...baseMessage,
      type: 1,
      content: '图片说明',
      image: {
        url: 'https://img.example/chat.webp',
        width: 800,
        height: 600,
        size: 12345,
        mime: 'image/webp',
        name: 'chat.webp'
      }
    })

    const imageButton = container.querySelector(
      'button[aria-label="查看图片 1"]'
    )
    expect(imageButton).not.toBeNull()

    await act(async () => {
      imageButton!.dispatchEvent(
        new dom!.window.MouseEvent('contextmenu', {
          bubbles: true,
          clientX: 100,
          clientY: 100
        })
      )
      await Promise.resolve()
    })

    expect(container.textContent).toContain('复制图片链接')
    expect(container.textContent).toContain('复制文本')
  })

  it('falls back to execCommand when copying an image link through the clipboard API fails', async () => {
    const { container } = await renderMessage({
      ...baseMessage,
      type: 1,
      content: '',
      image: {
        url: 'https://img.example/chat.webp',
        width: 800,
        height: 600,
        size: 12345,
        mime: 'image/webp',
        name: 'chat.webp'
      }
    })
    const clipboardWriteText = vi.fn().mockRejectedValue(new Error('denied'))
    Object.defineProperty(dom!.window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWriteText }
    })
    vi.stubGlobal('navigator', dom!.window.navigator)
    Object.defineProperty(dom!.window.document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => true)
    })

    const imageButton = container.querySelector(
      'button[aria-label="查看图片 1"]'
    )
    expect(imageButton).not.toBeNull()

    await act(async () => {
      imageButton!.dispatchEvent(
        new dom!.window.MouseEvent('contextmenu', {
          bubbles: true,
          clientX: 100,
          clientY: 100
        })
      )
      await Promise.resolve()
    })

    const copyImageButton = Array.from(
      container.querySelectorAll('button')
    ).find((button) => button.textContent === '复制图片链接')
    expect(copyImageButton).toBeDefined()

    await act(async () => {
      copyImageButton!.click()
      await Promise.resolve()
    })

    expect(clipboardWriteText).toHaveBeenCalledWith(
      'https://img.example/chat.webp'
    )
    expect(dom!.window.document.execCommand).toHaveBeenCalledWith('copy')
  })

  it('does not open the message menu when image preview receives touch pointers', async () => {
    const { container } = await renderMessage({
      ...baseMessage,
      type: 1,
      content: '',
      image: {
        url: 'https://img.example/chat.webp',
        width: 800,
        height: 600,
        size: 12345,
        mime: 'image/webp',
        name: 'chat.webp'
      }
    })

    const imageButton = container.querySelector(
      'button[aria-label="查看图片 1"]'
    )
    expect(imageButton).not.toBeNull()

    const pointerDown = new dom!.window.MouseEvent('pointerdown', {
      bubbles: true,
      clientX: 80,
      clientY: 80
    })
    Object.defineProperties(pointerDown, {
      pointerType: { value: 'touch' },
      isPrimary: { value: true },
      pointerId: { value: 1 }
    })

    const pointerUp = new dom!.window.MouseEvent('pointerup', {
      bubbles: true,
      clientX: 82,
      clientY: 82
    })
    Object.defineProperties(pointerUp, {
      pointerType: { value: 'touch' },
      isPrimary: { value: true },
      pointerId: { value: 1 }
    })

    await act(async () => {
      imageButton!.dispatchEvent(pointerDown)
      imageButton!.dispatchEvent(pointerUp)
      await Promise.resolve()
    })

    expect(container.textContent).not.toContain('回复')
  })

  it('uses blurred side fill for single image messages with captions', async () => {
    const { container } = await renderMessage({
      ...baseMessage,
      type: 1,
      content: '图片说明',
      image: {
        url: 'https://img.example/chat.webp',
        width: 480,
        height: 960,
        size: 12345,
        mime: 'image/webp',
        name: 'chat.webp'
      }
    })

    const imageGrid = container.querySelector(
      'button[aria-label="查看图片 1"]'
    )?.parentElement
    const blurImage = container.querySelector<HTMLImageElement>(
      'img[aria-hidden="true"]'
    )

    expect(imageGrid?.className).toContain('bg-default-200')
    expect(blurImage?.className).toContain('blur-xl')
  })

  it('keeps portrait image-only previews narrow enough to avoid side whitespace', async () => {
    const { container } = await renderMessage({
      ...baseMessage,
      type: 1,
      content: '',
      image: {
        url: 'https://img.example/portrait.webp',
        width: 480,
        height: 960,
        size: 12345,
        mime: 'image/webp',
        name: 'portrait.webp'
      }
    })

    expect(
      container
        .querySelector('button[aria-label="查看图片 1"]')
        ?.getAttribute('style')
    ).toContain('width: 16rem')
  })

  it('passes every image in a multi-image message to the lightbox carousel', async () => {
    await renderMessage({
      ...baseMessage,
      type: 1,
      content: '',
      images: [
        {
          url: 'https://img.example/a.webp',
          width: 800,
          height: 600,
          size: 12345,
          mime: 'image/webp',
          name: 'a.webp'
        },
        {
          url: 'https://img.example/b.webp',
          width: 900,
          height: 600,
          size: 12345,
          mime: 'image/webp',
          name: 'b.webp'
        }
      ],
      image: {
        url: 'https://img.example/a.webp',
        width: 800,
        height: 600,
        size: 12345,
        mime: 'image/webp',
        name: 'a.webp'
      }
    })

    expect(imageViewerMock.images.map((image) => image.src)).toEqual([
      'https://img.example/a.webp',
      'https://img.example/b.webp'
    ])
  })

  it('highlights the right-clicked image and replies with that image index', async () => {
    const onReply = vi.fn()
    const multiImageMessage: PrivateMessage = {
      ...baseMessage,
      type: 1,
      content: '',
      images: [
        {
          url: 'https://img.example/a.webp',
          width: 800,
          height: 600,
          size: 12345,
          mime: 'image/webp',
          name: 'a.webp'
        },
        {
          url: 'https://img.example/b.webp',
          width: 900,
          height: 600,
          size: 12345,
          mime: 'image/webp',
          name: 'b.webp'
        }
      ],
      image: {
        url: 'https://img.example/a.webp',
        width: 800,
        height: 600,
        size: 12345,
        mime: 'image/webp',
        name: 'a.webp'
      }
    }
    const { container } = await renderMessage(multiImageMessage, { onReply })

    const secondImageButton = container.querySelector(
      'button[aria-label="查看图片 2"]'
    )
    expect(secondImageButton).not.toBeNull()

    await act(async () => {
      secondImageButton!.dispatchEvent(
        new dom!.window.MouseEvent('contextmenu', {
          bubbles: true,
          clientX: 100,
          clientY: 100
        })
      )
      await Promise.resolve()
    })

    expect(
      secondImageButton!.querySelector(
        '[data-testid="chat-image-context-overlay"]'
      )
    ).not.toBeNull()
    expect(
      container.querySelector(
        'button[aria-label="查看图片 1"] [data-testid="chat-image-context-overlay"]'
      )
    ).toBeNull()

    const replyButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '回复'
    )
    expect(replyButton).toBeDefined()

    await act(async () => {
      replyButton!.click()
      await Promise.resolve()
    })

    expect(onReply).toHaveBeenCalledWith(multiImageMessage, null, 1)
  })

  it('keeps reply image messages tight without changing the quote block', async () => {
    const { container } = await renderMessage({
      ...baseMessage,
      type: 1,
      content: '',
      image: {
        url: 'https://img.example/chat.webp',
        width: 800,
        height: 600,
        size: 12345,
        mime: 'image/webp',
        name: 'chat.webp'
      },
      replyTo: {
        messageId: 2,
        senderName: 'Mio',
        content: 'original',
        selectedText: null
      }
    })

    const quote = container.querySelector('[data-testid="chat-reply-preview"]')
    const imageGrid = container.querySelector(
      'button[aria-label="查看图片 1"]'
    )?.parentElement

    expect(quote?.className).toContain('py-1')
    expect(quote?.className).toContain('before:rounded-full')
    expect(quote?.className).toContain('before:top-0')
    expect(quote?.className).toContain('before:bottom-0')
    expect(quote?.className).not.toContain('before:top-1')
    expect(quote?.className).not.toContain('border-l-3')
    expect(imageGrid?.className).toContain('-mx-2')
    expect(
      container.querySelector('[data-testid="chat-message-bubble"]')?.className
    ).toContain('px-2.5')
  })

  it('highlights the referenced text segment after a reply preview jump', async () => {
    const { container } = await renderMessage(
      {
        ...baseMessage,
        content: 'hello selected text'
      },
      {
        replyHighlight: {
          messageId: baseMessage.id,
          kind: 'text',
          selectedText: 'selected'
        },
        isReplyHighlightFading: true
      }
    )

    const highlight = container.querySelector(
      '[data-testid="chat-reply-text-highlight"]'
    )
    expect(highlight).not.toBeNull()
    expect(highlight?.textContent).toBe('selected')
    expect(highlight?.className).toContain(
      'bg-[hsl(var(--kun-brand-500)/0.34)]'
    )
    expect(highlight?.className).toContain('transition-opacity')
    expect(highlight?.className).toContain('opacity-0')
    expect(
      container.querySelector('[data-testid="chat-reply-bubble-highlight"]')
    ).toBeNull()
  })

  it('does not fall back to a whole bubble highlight for unmatched partial text replies', async () => {
    const { container } = await renderMessage(
      {
        ...baseMessage,
        content: 'hello selected text'
      },
      {
        replyHighlight: {
          messageId: baseMessage.id,
          kind: 'text',
          selectedText: 'edited away'
        }
      }
    )

    expect(
      container.querySelector('[data-testid="chat-reply-text-highlight"]')
    ).toBeNull()
    expect(
      container.querySelector('[data-testid="chat-reply-bubble-highlight"]')
    ).toBeNull()
  })

  it('highlights the whole bubble after a full-message reply preview jump', async () => {
    const { container } = await renderMessage(baseMessage, {
      replyHighlight: {
        messageId: baseMessage.id,
        kind: 'bubble'
      }
    })

    const highlight = container.querySelector(
      '[data-testid="chat-reply-bubble-highlight"]'
    )
    expect(highlight).not.toBeNull()
    expect(highlight?.className).toContain(
      'bg-[hsl(var(--kun-brand-500)/0.30)]'
    )
    expect(highlight?.className).toContain('transition-opacity')
    expect(highlight?.className).toContain('opacity-100')
  })

  it('highlights the referenced image after a reply preview jump', async () => {
    const { container } = await renderMessage(
      {
        ...baseMessage,
        type: 1,
        content: '',
        image: {
          url: 'https://img.example/chat.webp',
          width: 800,
          height: 600,
          size: 12345,
          mime: 'image/webp',
          name: 'chat.webp'
        }
      },
      {
        replyHighlight: {
          messageId: baseMessage.id,
          kind: 'image',
          image: {
            url: 'https://img.example/chat.webp',
            width: 800,
            height: 600,
            size: 12345,
            mime: 'image/webp',
            name: 'chat.webp'
          }
        },
        isReplyHighlightFading: true
      }
    )

    const highlight = container.querySelector(
      'button[aria-label="查看图片 1"] [data-testid="chat-image-context-overlay"]'
    )
    expect(highlight).not.toBeNull()
    expect(highlight?.className).toContain(
      'bg-[hsl(var(--kun-brand-500)/0.30)]'
    )
    expect(highlight?.className).toContain('transition-opacity')
    expect(highlight?.className).toContain('opacity-0')
  })

  it('renders a reply image thumbnail and reports preview clicks', async () => {
    const onReplyPreviewClick = vi.fn()
    const { container } = await renderMessage(
      {
        ...baseMessage,
        replyTo: {
          messageId: 2,
          senderName: 'Mio',
          content: '[图片]',
          selectedText: null,
          image: {
            url: 'https://img.example/quoted.webp',
            width: 240,
            height: 180,
            size: 123,
            mime: 'image/webp',
            name: 'quoted.webp'
          }
        }
      },
      { onReplyPreviewClick }
    )

    const quote = container.querySelector('[data-testid="chat-reply-preview"]')
    expect(quote).not.toBeNull()
    expect(
      quote!.querySelector<HTMLImageElement>('img[alt="quoted.webp"]')?.src
    ).toBe('https://img.example/quoted.webp')

    await act(async () => {
      quote!.dispatchEvent(
        new dom!.window.MouseEvent('click', {
          bubbles: true
        })
      )
      await Promise.resolve()
    })

    expect(onReplyPreviewClick).toHaveBeenCalledWith(
      {
        messageId: 2,
        senderName: 'Mio',
        content: '[图片]',
        selectedText: null,
        image: {
          url: 'https://img.example/quoted.webp',
          width: 240,
          height: 180,
          size: 123,
          mime: 'image/webp',
          name: 'quoted.webp'
        }
      },
      3
    )
  })
})
