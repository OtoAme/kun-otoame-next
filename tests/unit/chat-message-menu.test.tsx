import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { PrivateMessage } from '~/types/api/conversation'

globalThis.React = React

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
    isLoading: _isLoading,
    isIconOnly: _isIconOnly,
    variant: _variant,
    color: _color,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    onPress?: () => void
    isLoading?: boolean
    isIconOnly?: boolean
    variant?: string
    color?: string
  }) => (
    <button {...props} onClick={onPress}>
      {children}
    </button>
  )
}))

vi.mock('@heroui/modal', () => ({
  Modal: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
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
  useDisclosure: () => ({
    isOpen: false,
    onOpen: vi.fn(),
    onOpenChange: vi.fn(),
    onClose: vi.fn()
  })
}))

vi.mock('@heroui/input', () => ({
  Textarea: () => <textarea />
}))

vi.mock('~/components/kun/floating-card/KunAvatar', () => ({
  KunAvatar: () => <div data-testid="avatar" />
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
    options: { isOwn?: boolean; onReply?: ReturnType<typeof vi.fn> } = {}
  ) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('Range', dom.window.Range)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { ChatMessage } = await import('~/components/message/chat/ChatMessage')
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
          onMessageUpdated={vi.fn()}
        />
      )
    })

    return { container: container!, onReply: options.onReply }
  }

  const openContextMenu = async (container: HTMLElement) => {
    const bubble = container.querySelector('[data-testid="chat-message-bubble"]')
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

  beforeEach(() => {
    vi.resetModules()
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

  it('renders a read indicator for own read messages', async () => {
    const { container } = await renderMessage(
      { ...baseMessage, status: 1, sender: { id: 1007, name: 'Saya', avatar: '' } },
      { isOwn: true }
    )

    expect(container.textContent).toContain('已读')
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
  })
})
