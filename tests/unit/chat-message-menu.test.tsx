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
      onReplyPreviewClick?: (replyTo: PrivateMessageReplyPreview) => void
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

  const selectMessageText = (container: HTMLElement) => {
    const text = container.querySelector('p')
    expect(text).not.toBeNull()

    const range = dom!.window.document.createRange()
    range.selectNodeContents(text!)
    dom!.window.getSelection()?.removeAllRanges()
    dom!.window.getSelection()?.addRange(range)
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

  it('uses a soft themed bubble for own messages', async () => {
    const { container } = await renderMessage(
      { ...baseMessage, sender: { id: 1007, name: 'Saya', avatar: '' } },
      { isOwn: true }
    )

    const bubble = container.querySelector(
      '[data-testid="chat-message-bubble"]'
    )
    expect(bubble?.className).toContain('bg-[hsl(var(--kun-brand-50)/0.96)]')
    expect(bubble?.className).toContain('md:max-w-[min(60%,42rem)]')
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

    expect(onReplyPreviewClick).toHaveBeenCalledWith({
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
    })
  })
})
