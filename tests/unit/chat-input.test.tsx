import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { PrivateMessage } from '~/types/api/conversation'

globalThis.React = React

const fetchMock = vi.hoisted(() => ({
  kunFetchFormData: vi.fn(),
  kunFetchPost: vi.fn()
}))

const textareaMock = vi.hoisted(() => ({
  onValueChange: undefined as ((value: string) => void) | undefined,
  onKeyDown: undefined as
    | React.KeyboardEventHandler<HTMLTextAreaElement>
    | undefined,
  onCompositionStart: undefined as
    | React.CompositionEventHandler<HTMLTextAreaElement>
    | undefined,
  onCompositionEnd: undefined as
    | React.CompositionEventHandler<HTMLTextAreaElement>
    | undefined,
  onPaste: undefined as
    | React.ClipboardEventHandler<HTMLTextAreaElement>
    | undefined
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchFormData: fetchMock.kunFetchFormData,
  kunFetchPost: fetchMock.kunFetchPost
}))

vi.mock('@heroui/input', () => ({
  Textarea: React.forwardRef<
    HTMLTextAreaElement,
    {
      value: string
      onValueChange?: (value: string) => void
      onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>
      onCompositionStart?: React.CompositionEventHandler<HTMLTextAreaElement>
      onCompositionEnd?: React.CompositionEventHandler<HTMLTextAreaElement>
      onPaste?: React.ClipboardEventHandler<HTMLTextAreaElement>
      placeholder?: string
    }
  >(
    (
      {
        value,
        onValueChange,
        onKeyDown,
        onCompositionStart,
        onCompositionEnd,
        onPaste,
        placeholder
      },
      ref
    ) => {
      textareaMock.onValueChange = onValueChange
      textareaMock.onKeyDown = onKeyDown
      textareaMock.onCompositionStart = onCompositionStart
      textareaMock.onCompositionEnd = onCompositionEnd
      textareaMock.onPaste = onPaste

      return (
        <textarea
          aria-label="私聊输入"
          ref={ref}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onValueChange?.(event.target.value)}
          onKeyDown={onKeyDown}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          onPaste={onPaste}
        />
      )
    }
  )
}))

vi.mock('~/components/kun/image-viewer/ImageViewer', () => ({
  KunImageViewer: ({
    children
  }: {
    children: (openLightbox: (index: number) => void) => React.ReactNode
  }) => <>{children(vi.fn())}</>
}))

vi.mock('@heroui/react', () => ({
  Button: ({
    children,
    isDisabled,
    isLoading,
    'aria-label': ariaLabel,
    onPress
  }: {
    children?: React.ReactNode
    isDisabled?: boolean
    isLoading?: boolean
    'aria-label'?: string
    onPress?: () => void
  }) => (
    <button
      aria-label={ariaLabel}
      disabled={isDisabled || isLoading}
      onClick={onPress}
    >
      {children}
    </button>
  )
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn()
  }
}))

describe('ChatInput keyboard handling', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined
  let onMessageSent: ReturnType<typeof vi.fn<(message: PrivateMessage) => void>>

  const sentMessage = (
    id: number,
    content: string,
    overrides: Partial<PrivateMessage> = {}
  ): PrivateMessage => ({
    id,
    type: 0,
    content,
    status: 0,
    isDeleted: false,
    image: null,
    replyTo: null,
    editedAt: null,
    created: '2026-06-30T00:00:00.000Z',
    sender: { id: 1007, name: 'Saya', avatar: '/saya.webp' },
    ...overrides
  })

  const renderChatInput = async (
    props: Partial<{
      replyTarget: PrivateMessage
      replySelectedText: string | null
      replyImageIndex: number | null
      onCancelReply: () => void
    }> = {}
  ) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    Object.defineProperty(dom.window.HTMLElement.prototype, 'attachEvent', {
      configurable: true,
      value: vi.fn()
    })
    Object.defineProperty(dom.window.HTMLElement.prototype, 'detachEvent', {
      configurable: true,
      value: vi.fn()
    })
    Object.assign(dom.window.URL, {
      createObjectURL: vi.fn(() => 'blob:http://localhost/chat-preview'),
      revokeObjectURL: vi.fn()
    })
    vi.stubGlobal('URL', dom.window.URL)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    onMessageSent = vi.fn<(message: PrivateMessage) => void>()
    fetchMock.kunFetchPost.mockResolvedValue(sentMessage(7, 'hello'))

    const { ChatInput } = await import('~/components/message/chat/ChatInput')
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    const renderWithProps = async (
      nextProps: Partial<{
        replyTarget: PrivateMessage
        replySelectedText: string | null
        replyImageIndex: number | null
        onCancelReply: () => void
      }> = props
    ) => {
      await act(async () => {
        root!.render(
          <ChatInput
            conversationId={5}
            onMessageSent={onMessageSent}
            {...nextProps}
          />
        )
      })
    }

    await renderWithProps()

    const textarea = container!.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="私聊输入"]'
    )
    expect(textarea).not.toBeNull()

    return {
      container: container!,
      textarea: textarea!,
      rerender: renderWithProps
    }
  }

  const typeContent = async (textarea: HTMLTextAreaElement, value: string) => {
    await act(async () => {
      textareaMock.onValueChange?.(value)
      await Promise.resolve()
    })
  }

  const keyDownEnter = async (
    textarea: HTMLTextAreaElement,
    options: KeyboardEventInit = {}
  ) => {
    const event = createEnterEvent(textarea, options)

    await act(async () => {
      textareaMock.onKeyDown?.(event)
      await Promise.resolve()
    })

    return event
  }

  const createEnterEvent = (
    textarea: HTMLTextAreaElement,
    options: KeyboardEventInit = {}
  ) => {
    const event = {
      key: 'Enter',
      ctrlKey: false,
      shiftKey: false,
      metaKey: false,
      altKey: false,
      nativeEvent: { isComposing: false },
      target: textarea,
      currentTarget: textarea,
      preventDefault: vi.fn(),
      ...options
    } as unknown as React.KeyboardEvent<HTMLTextAreaElement>

    return event
  }

  beforeEach(() => {
    fetchMock.kunFetchFormData.mockReset()
    fetchMock.kunFetchPost.mockReset()
    textareaMock.onValueChange = undefined
    textareaMock.onKeyDown = undefined
    textareaMock.onCompositionStart = undefined
    textareaMock.onCompositionEnd = undefined
    textareaMock.onPaste = undefined
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('does not send while an IME composition is active', async () => {
    const { textarea } = await renderChatInput()
    await typeContent(textarea, 'k')

    await act(async () => {
      textareaMock.onCompositionStart?.(
        {} as React.CompositionEvent<HTMLTextAreaElement>
      )
    })

    await keyDownEnter(textarea)

    expect(fetchMock.kunFetchPost).not.toHaveBeenCalled()
    expect(onMessageSent).not.toHaveBeenCalled()
  })

  it('uses Shift+Enter for a newline instead of sending', async () => {
    const { textarea } = await renderChatInput()
    await typeContent(textarea, 'hello')
    textarea.selectionStart = textarea.selectionEnd = 5

    await keyDownEnter(textarea, { shiftKey: true })

    expect(fetchMock.kunFetchPost).not.toHaveBeenCalled()
    expect(textarea.value).toBe('hello\n')
  })

  it('sends once when Enter is pressed repeatedly before the request settles', async () => {
    let resolveSend!: (value: PrivateMessage) => void
    fetchMock.kunFetchPost.mockReturnValue(
      new Promise((resolve) => {
        resolveSend = resolve
      })
    )

    const { textarea } = await renderChatInput()
    await typeContent(textarea, 'hello')

    await act(async () => {
      textareaMock.onKeyDown?.(createEnterEvent(textarea))
      textareaMock.onKeyDown?.(createEnterEvent(textarea))
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchPost).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveSend(sentMessage(7, 'hello'))
      await Promise.resolve()
    })

    expect(onMessageSent).toHaveBeenCalledTimes(1)
  })

  it('shows a retryable error when sending a text message throws', async () => {
    const toast = (await import('react-hot-toast')).default
    vi.mocked(toast.error).mockClear()
    fetchMock.kunFetchPost.mockRejectedValueOnce(new Error('network down'))

    const { textarea } = await renderChatInput()
    await typeContent(textarea, 'hello')

    await keyDownEnter(textarea)

    expect(onMessageSent).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('消息发送失败，请稍后重试')
    const sendButton = dom!.window.document.querySelector<HTMLButtonElement>(
      'button[aria-label="发送消息"]'
    )
    expect(sendButton?.disabled).toBe(false)
  })

  it('sends reply metadata with the message payload', async () => {
    const replyTarget: PrivateMessage = {
      id: 3,
      type: 0,
      content: 'original',
      status: 0,
      isDeleted: false,
      image: null,
      replyTo: null,
      editedAt: null,
      created: '2026-06-30T09:00:00.000Z',
      sender: { id: 8, name: 'Mio', avatar: '/mio.webp' }
    }

    const { container, textarea } = await renderChatInput({
      replyTarget,
      replySelectedText: 'orig',
      onCancelReply: vi.fn()
    })
    expect(container.textContent).toContain('回复 Mio')
    const replyPreview = container.querySelector(
      '[data-testid="chat-reply-preview"]'
    )
    expect(replyPreview?.className).toContain('pl-3.5')
    expect(replyPreview?.className).toContain('before:rounded-full')
    expect(replyPreview?.className).toContain('before:top-0')
    expect(replyPreview?.className).toContain('before:bottom-0')
    expect(replyPreview?.className).not.toContain('border-l-3')
    expect(container.innerHTML).not.toContain('bg-primary-50')
    await typeContent(textarea, 'reply')
    await keyDownEnter(textarea)

    expect(fetchMock.kunFetchPost).toHaveBeenCalledWith(
      '/message/conversation/5',
      expect.objectContaining({
        type: 0,
        content: 'reply',
        replyToMessageId: 3,
        replySelectedText: 'orig'
      })
    )
  })

  it('focuses the input at the draft end when a reply target is set', async () => {
    const replyTarget: PrivateMessage = {
      id: 3,
      type: 0,
      content: 'original',
      status: 0,
      isDeleted: false,
      image: null,
      replyTo: null,
      editedAt: null,
      created: '2026-06-30T09:00:00.000Z',
      sender: { id: 8, name: 'Mio', avatar: '/mio.webp' }
    }

    const { textarea, rerender } = await renderChatInput()
    await typeContent(textarea, 'draft text')
    textarea.focus()
    textarea.setSelectionRange(0, 0)

    await rerender({
      replyTarget,
      replySelectedText: null,
      onCancelReply: vi.fn()
    })

    expect(dom!.window.document.activeElement).toBe(textarea)
    expect(textarea.selectionStart).toBe('draft text'.length)
    expect(textarea.selectionEnd).toBe('draft text'.length)
  })

  it('shows a reply image thumbnail and sends the reply image index', async () => {
    const replyTarget: PrivateMessage = {
      id: 3,
      type: 1,
      content: '',
      status: 0,
      isDeleted: false,
      image: {
        url: 'https://img.example/a.webp',
        width: 800,
        height: 600,
        size: 1,
        mime: 'image/webp',
        name: 'a.webp'
      },
      images: [
        {
          url: 'https://img.example/a.webp',
          width: 800,
          height: 600,
          size: 1,
          mime: 'image/webp',
          name: 'a.webp'
        },
        {
          url: 'https://img.example/b.webp',
          width: 900,
          height: 600,
          size: 1,
          mime: 'image/webp',
          name: 'b.webp'
        }
      ],
      replyTo: null,
      editedAt: null,
      created: '2026-06-30T09:00:00.000Z',
      sender: { id: 8, name: 'Mio', avatar: '/mio.webp' }
    }

    const { container, textarea } = await renderChatInput({
      replyTarget,
      replySelectedText: null,
      replyImageIndex: 1,
      onCancelReply: vi.fn()
    })

    const quoteImage = container.querySelector<HTMLImageElement>(
      '[data-testid="chat-reply-preview"] img[alt="b.webp"]'
    )
    expect(quoteImage?.src).toBe('https://img.example/b.webp')

    await typeContent(textarea, 'reply')
    await keyDownEnter(textarea)

    expect(fetchMock.kunFetchPost).toHaveBeenCalledWith(
      '/message/conversation/5',
      expect.objectContaining({
        type: 0,
        content: 'reply',
        replyToMessageId: 3,
        replyImageIndex: 1
      })
    )
  })

  it('sends an image-only message from the plus menu', async () => {
    fetchMock.kunFetchFormData.mockResolvedValueOnce({
      url: 'https://img.example/conversation/5/chat.avif',
      width: 800,
      height: 600,
      size: 5,
      mime: 'image/avif',
      name: 'chat.avif'
    })
    fetchMock.kunFetchPost.mockResolvedValueOnce(
      sentMessage(8, '', {
        type: 1,
        image: {
          url: 'https://img.example/conversation/5/chat.avif',
          width: 800,
          height: 600,
          size: 5,
          mime: 'image/avif',
          name: 'chat.avif'
        }
      })
    )

    const { container } = await renderChatInput()

    const plusButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="添加附件"]'
    )
    expect(plusButton).not.toBeNull()

    await act(async () => {
      plusButton?.click()
      await Promise.resolve()
    })

    const imageButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="选择图片"]'
    )
    expect(imageButton).not.toBeNull()

    const fileInput =
      container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(fileInput).not.toBeNull()
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [new File(['image'], 'chat.webp', { type: 'image/webp' })]
    })

    await act(async () => {
      imageButton?.click()
      fileInput?.dispatchEvent(
        new dom!.window.Event('change', { bubbles: true })
      )
      await Promise.resolve()
    })

    const sendButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="发送消息"]'
    )
    expect(sendButton).not.toBeNull()

    await act(async () => {
      sendButton?.click()
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchFormData).toHaveBeenCalledWith(
      '/message/conversation/5/image',
      expect.any(FormData)
    )
    expect(fetchMock.kunFetchPost).toHaveBeenCalledWith(
      '/message/conversation/5',
      expect.objectContaining({
        type: 1,
        image: expect.objectContaining({
          url: 'https://img.example/conversation/5/chat.avif'
        }),
        images: [
          expect.objectContaining({
            url: 'https://img.example/conversation/5/chat.avif'
          })
        ]
      })
    )
  })

  it('clears the file input after a successful image send', async () => {
    fetchMock.kunFetchFormData.mockResolvedValueOnce({
      url: 'https://img.example/conversation/5/chat.avif',
      width: 800,
      height: 600,
      size: 5,
      mime: 'image/avif',
      name: 'chat.avif'
    })
    fetchMock.kunFetchPost.mockResolvedValueOnce(
      sentMessage(8, '', {
        type: 1,
        image: {
          url: 'https://img.example/conversation/5/chat.avif',
          width: 800,
          height: 600,
          size: 5,
          mime: 'image/avif',
          name: 'chat.avif'
        }
      })
    )

    const { container } = await renderChatInput()
    const fileInput =
      container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(fileInput).not.toBeNull()
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [new File(['image'], 'chat.webp', { type: 'image/webp' })]
    })
    Object.defineProperty(fileInput, 'value', {
      configurable: true,
      writable: true,
      value: 'C:\\fakepath\\chat.webp'
    })

    await act(async () => {
      fileInput?.dispatchEvent(
        new dom!.window.Event('change', { bubbles: true })
      )
      await Promise.resolve()
    })

    const sendButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="发送消息"]'
    )
    await act(async () => {
      sendButton?.click()
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchPost).toHaveBeenCalledTimes(1)
    expect(fileInput?.value).toBe('')
  })

  it('renders the attachment menu above selected image previews', async () => {
    const { container } = await renderChatInput()
    const fileInput =
      container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(fileInput).not.toBeNull()
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [new File(['image'], 'chat.webp', { type: 'image/webp' })]
    })

    await act(async () => {
      fileInput?.dispatchEvent(
        new dom!.window.Event('change', { bubbles: true })
      )
      await Promise.resolve()
    })

    expect(container.textContent).toContain('chat.webp')

    const plusButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="添加附件"]'
    )
    expect(plusButton).not.toBeNull()

    await act(async () => {
      plusButton?.click()
      await Promise.resolve()
    })

    const attachmentMenu = container.querySelector<HTMLElement>(
      '[role="menu"][aria-label="附件"]'
    )
    expect(attachmentMenu).not.toBeNull()
    expect(attachmentMenu?.className).toContain('z-50')
  })

  it('closes the attachment menu when Escape is pressed', async () => {
    const { container } = await renderChatInput()

    const plusButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="添加附件"]'
    )
    expect(plusButton).not.toBeNull()

    await act(async () => {
      plusButton?.click()
      await Promise.resolve()
    })

    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="选择图片"]'
      )
    ).not.toBeNull()

    await act(async () => {
      document.dispatchEvent(
        new dom!.window.KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true
        })
      )
      await Promise.resolve()
    })

    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="选择图片"]'
      )
    ).toBeNull()
  })

  it('loads pasted clipboard images into the same preview and send flow', async () => {
    fetchMock.kunFetchFormData
      .mockResolvedValueOnce({
        url: 'https://img.example/conversation/5/a.avif',
        width: 800,
        height: 600,
        size: 5,
        mime: 'image/avif',
        name: 'a.avif'
      })
      .mockResolvedValueOnce({
        url: 'https://img.example/conversation/5/b.avif',
        width: 800,
        height: 600,
        size: 6,
        mime: 'image/avif',
        name: 'b.avif'
      })
    fetchMock.kunFetchPost.mockResolvedValueOnce(
      sentMessage(9, '', {
        type: 1,
        image: {
          url: 'https://img.example/conversation/5/a.avif',
          width: 800,
          height: 600,
          size: 5,
          mime: 'image/avif',
          name: 'a.avif'
        }
      })
    )

    const { container, textarea } = await renderChatInput()
    const files = [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' })
    ]

    await act(async () => {
      textareaMock.onPaste?.({
        clipboardData: { files },
        preventDefault: vi.fn()
      } as unknown as React.ClipboardEvent<HTMLTextAreaElement>)
      await Promise.resolve()
    })

    expect(container.textContent).toContain('2 张图片')
    const sendButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="发送消息"]'
    )

    await act(async () => {
      sendButton?.click()
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchFormData).toHaveBeenCalledTimes(2)
    expect(fetchMock.kunFetchPost).toHaveBeenCalledWith(
      '/message/conversation/5',
      expect.objectContaining({
        type: 1,
        images: [
          expect.objectContaining({
            url: 'https://img.example/conversation/5/a.avif'
          }),
          expect.objectContaining({
            url: 'https://img.example/conversation/5/b.avif'
          })
        ]
      })
    )
  })

  it('caps rapidly appended clipboard images at nine before the next render', async () => {
    const { container } = await renderChatInput()
    const firstBatch = Array.from(
      { length: 8 },
      (_, index) =>
        new File([`a-${index}`], `a-${index}.png`, { type: 'image/png' })
    )
    const secondBatch = Array.from(
      { length: 3 },
      (_, index) =>
        new File([`b-${index}`], `b-${index}.png`, { type: 'image/png' })
    )

    await act(async () => {
      textareaMock.onPaste?.({
        clipboardData: { files: firstBatch },
        preventDefault: vi.fn()
      } as unknown as React.ClipboardEvent<HTMLTextAreaElement>)
      textareaMock.onPaste?.({
        clipboardData: { files: secondBatch },
        preventDefault: vi.fn()
      } as unknown as React.ClipboardEvent<HTMLTextAreaElement>)
      await Promise.resolve()
    })

    expect(container.textContent).toContain('9 张图片')
    expect(
      container.querySelectorAll('button[aria-label^="查看待发送图片"]')
    ).toHaveLength(9)
    expect(
      container.querySelectorAll('button[aria-label^="移除第"]')
    ).toHaveLength(9)
  })

  it('removes one selected image from a multi-image draft before sending', async () => {
    fetchMock.kunFetchFormData
      .mockResolvedValueOnce({
        url: 'https://img.example/conversation/5/a.avif',
        width: 800,
        height: 600,
        size: 5,
        mime: 'image/avif',
        name: 'a.avif'
      })
      .mockResolvedValueOnce({
        url: 'https://img.example/conversation/5/c.avif',
        width: 700,
        height: 700,
        size: 7,
        mime: 'image/avif',
        name: 'c.avif'
      })
    fetchMock.kunFetchPost.mockResolvedValueOnce(
      sentMessage(12, '', {
        type: 1,
        image: {
          url: 'https://img.example/conversation/5/a.avif',
          width: 800,
          height: 600,
          size: 5,
          mime: 'image/avif',
          name: 'a.avif'
        }
      })
    )

    const { container, textarea } = await renderChatInput()
    const files = [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
      new File(['c'], 'c.avif', { type: 'image/avif' })
    ]

    await act(async () => {
      textareaMock.onPaste?.({
        clipboardData: { files },
        preventDefault: vi.fn()
      } as unknown as React.ClipboardEvent<HTMLTextAreaElement>)
      await Promise.resolve()
    })

    const removeSecondImageButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="移除第 2 张图片"]'
    )
    expect(removeSecondImageButton).not.toBeNull()

    await act(async () => {
      removeSecondImageButton?.click()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('2 张图片')

    const sendButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="发送消息"]'
    )
    await act(async () => {
      sendButton?.click()
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchFormData).toHaveBeenCalledTimes(2)
    expect(fetchMock.kunFetchPost).toHaveBeenCalledWith(
      '/message/conversation/5',
      expect.objectContaining({
        type: 1,
        images: [
          expect.objectContaining({
            url: 'https://img.example/conversation/5/a.avif'
          }),
          expect.objectContaining({
            url: 'https://img.example/conversation/5/c.avif'
          })
        ]
      })
    )
  })

  it('keeps successful image uploads when retrying a partially failed image send', async () => {
    fetchMock.kunFetchFormData
      .mockResolvedValueOnce({
        url: 'https://img.example/conversation/5/a.avif',
        width: 800,
        height: 600,
        size: 5,
        mime: 'image/avif',
        name: 'a.avif'
      })
      .mockResolvedValueOnce('图片上传过于频繁，请 60 秒后再试')

    const { container, textarea } = await renderChatInput()
    const files = [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' })
    ]

    await act(async () => {
      textareaMock.onPaste?.({
        clipboardData: { files },
        preventDefault: vi.fn()
      } as unknown as React.ClipboardEvent<HTMLTextAreaElement>)
      await Promise.resolve()
    })

    const sendButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="发送消息"]'
    )

    await act(async () => {
      sendButton?.click()
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchFormData).toHaveBeenCalledTimes(2)
    expect(fetchMock.kunFetchPost).not.toHaveBeenCalled()

    fetchMock.kunFetchFormData.mockResolvedValueOnce({
      url: 'https://img.example/conversation/5/b.avif',
      width: 900,
      height: 600,
      size: 6,
      mime: 'image/avif',
      name: 'b.avif'
    })
    fetchMock.kunFetchPost.mockResolvedValueOnce(
      sentMessage(10, '', {
        type: 1,
        image: {
          url: 'https://img.example/conversation/5/a.avif',
          width: 800,
          height: 600,
          size: 5,
          mime: 'image/avif',
          name: 'a.avif'
        }
      })
    )

    await act(async () => {
      sendButton?.click()
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchFormData).toHaveBeenCalledTimes(3)
    expect(fetchMock.kunFetchPost).toHaveBeenCalledWith(
      '/message/conversation/5',
      expect.objectContaining({
        type: 1,
        images: [
          expect.objectContaining({
            url: 'https://img.example/conversation/5/a.avif'
          }),
          expect.objectContaining({
            url: 'https://img.example/conversation/5/b.avif'
          })
        ]
      })
    )
  })

  it('shows a retryable error when an image upload request throws', async () => {
    const toast = (await import('react-hot-toast')).default
    vi.mocked(toast.error).mockClear()
    fetchMock.kunFetchFormData.mockRejectedValueOnce(new Error('网络连接失败'))

    const { container, textarea } = await renderChatInput()
    const files = [new File(['a'], 'a.png', { type: 'image/png' })]

    await act(async () => {
      textareaMock.onPaste?.({
        clipboardData: { files },
        preventDefault: vi.fn()
      } as unknown as React.ClipboardEvent<HTMLTextAreaElement>)
      await Promise.resolve()
    })

    const sendButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="发送消息"]'
    )
    await act(async () => {
      sendButton?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchPost).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('图片上传失败：网络连接失败')
    expect(sendButton?.disabled).toBe(false)
  })

  it('keeps successful image uploads when another upload request throws', async () => {
    const toast = (await import('react-hot-toast')).default
    vi.mocked(toast.error).mockClear()
    fetchMock.kunFetchFormData
      .mockResolvedValueOnce({
        url: 'https://img.example/conversation/5/a.avif',
        width: 800,
        height: 600,
        size: 5,
        mime: 'image/avif',
        name: 'a.avif'
      })
      .mockRejectedValueOnce(new Error('网络连接失败'))

    const { container, textarea } = await renderChatInput()
    const files = [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' })
    ]

    await act(async () => {
      textareaMock.onPaste?.({
        clipboardData: { files },
        preventDefault: vi.fn()
      } as unknown as React.ClipboardEvent<HTMLTextAreaElement>)
      await Promise.resolve()
    })

    const sendButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="发送消息"]'
    )

    await act(async () => {
      sendButton?.click()
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchFormData).toHaveBeenCalledTimes(2)
    expect(fetchMock.kunFetchPost).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('图片上传失败：网络连接失败')

    fetchMock.kunFetchFormData.mockResolvedValueOnce({
      url: 'https://img.example/conversation/5/b.avif',
      width: 900,
      height: 600,
      size: 6,
      mime: 'image/avif',
      name: 'b.avif'
    })
    fetchMock.kunFetchPost.mockResolvedValueOnce(
      sentMessage(13, '', {
        type: 1,
        image: {
          url: 'https://img.example/conversation/5/a.avif',
          width: 800,
          height: 600,
          size: 5,
          mime: 'image/avif',
          name: 'a.avif'
        }
      })
    )

    await act(async () => {
      sendButton?.click()
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchFormData).toHaveBeenCalledTimes(3)
    expect(fetchMock.kunFetchPost).toHaveBeenCalledWith(
      '/message/conversation/5',
      expect.objectContaining({
        type: 1,
        images: [
          expect.objectContaining({
            url: 'https://img.example/conversation/5/a.avif'
          }),
          expect.objectContaining({
            url: 'https://img.example/conversation/5/b.avif'
          })
        ]
      })
    )
  })

  it('keeps successful image uploads when adding another image before retrying', async () => {
    fetchMock.kunFetchFormData
      .mockResolvedValueOnce({
        url: 'https://img.example/conversation/5/a.avif',
        width: 800,
        height: 600,
        size: 5,
        mime: 'image/avif',
        name: 'a.avif'
      })
      .mockResolvedValueOnce('图片上传过于频繁，请 60 秒后再试')

    const { container, textarea } = await renderChatInput()
    const initialFiles = [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' })
    ]

    await act(async () => {
      textareaMock.onPaste?.({
        clipboardData: { files: initialFiles },
        preventDefault: vi.fn()
      } as unknown as React.ClipboardEvent<HTMLTextAreaElement>)
      await Promise.resolve()
    })

    const sendButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="发送消息"]'
    )

    await act(async () => {
      sendButton?.click()
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchFormData).toHaveBeenCalledTimes(2)
    expect(fetchMock.kunFetchPost).not.toHaveBeenCalled()

    const appendedFiles = [new File(['c'], 'c.avif', { type: 'image/avif' })]
    await act(async () => {
      textareaMock.onPaste?.({
        clipboardData: { files: appendedFiles },
        preventDefault: vi.fn()
      } as unknown as React.ClipboardEvent<HTMLTextAreaElement>)
      await Promise.resolve()
    })

    fetchMock.kunFetchFormData
      .mockResolvedValueOnce({
        url: 'https://img.example/conversation/5/b.avif',
        width: 900,
        height: 600,
        size: 6,
        mime: 'image/avif',
        name: 'b.avif'
      })
      .mockResolvedValueOnce({
        url: 'https://img.example/conversation/5/c.avif',
        width: 700,
        height: 700,
        size: 7,
        mime: 'image/avif',
        name: 'c.avif'
      })
    fetchMock.kunFetchPost.mockResolvedValueOnce(
      sentMessage(11, '', {
        type: 1,
        image: {
          url: 'https://img.example/conversation/5/a.avif',
          width: 800,
          height: 600,
          size: 5,
          mime: 'image/avif',
          name: 'a.avif'
        }
      })
    )

    await act(async () => {
      sendButton?.click()
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchFormData).toHaveBeenCalledTimes(4)
    expect(fetchMock.kunFetchPost).toHaveBeenCalledWith(
      '/message/conversation/5',
      expect.objectContaining({
        type: 1,
        images: [
          expect.objectContaining({
            url: 'https://img.example/conversation/5/a.avif'
          }),
          expect.objectContaining({
            url: 'https://img.example/conversation/5/b.avif'
          }),
          expect.objectContaining({
            url: 'https://img.example/conversation/5/c.avif'
          })
        ]
      })
    )
  })
})
