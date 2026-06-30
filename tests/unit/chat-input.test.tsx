import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { PrivateMessage } from '~/types/api/conversation'

globalThis.React = React

const fetchMock = vi.hoisted(() => ({
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
    | undefined
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchPost: fetchMock.kunFetchPost
}))

vi.mock('@heroui/input', () => ({
  Textarea: ({
    value,
    onValueChange,
    onKeyDown,
    onCompositionStart,
    onCompositionEnd,
    placeholder
  }: {
    value: string
    onValueChange?: (value: string) => void
    onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>
    onCompositionStart?: React.CompositionEventHandler<HTMLTextAreaElement>
    onCompositionEnd?: React.CompositionEventHandler<HTMLTextAreaElement>
    placeholder?: string
  }) => {
    textareaMock.onValueChange = onValueChange
    textareaMock.onKeyDown = onKeyDown
    textareaMock.onCompositionStart = onCompositionStart
    textareaMock.onCompositionEnd = onCompositionEnd

    return (
      <textarea
        aria-label="私聊输入"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onValueChange?.(event.target.value)}
        onKeyDown={onKeyDown}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
      />
    )
  }
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
  let onMessageSent: ReturnType<
    typeof vi.fn<
      (message: { id: number; content: string; created: string }) => void
    >
  >

  const renderChatInput = async (
    props: Partial<{
      replyTarget: PrivateMessage
      replySelectedText: string | null
      onCancelReply: () => void
    }> = {}
  ) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    onMessageSent = vi.fn<
      (message: { id: number; content: string; created: string }) => void
    >()
    fetchMock.kunFetchPost.mockResolvedValue({
      id: 7,
      content: 'hello',
      created: '2026-06-30T00:00:00.000Z'
    })

    const { ChatInput } = await import('~/components/message/chat/ChatInput')
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(
        <ChatInput
          conversationId={5}
          onMessageSent={onMessageSent}
          {...props}
        />
      )
    })

    const textarea = container!.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="私聊输入"]'
    )
    expect(textarea).not.toBeNull()

    return { container: container!, textarea: textarea! }
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
    fetchMock.kunFetchPost.mockReset()
    textareaMock.onValueChange = undefined
    textareaMock.onKeyDown = undefined
    textareaMock.onCompositionStart = undefined
    textareaMock.onCompositionEnd = undefined
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
    let resolveSend!: (value: { id: number; content: string; created: string }) => void
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
      resolveSend({
        id: 7,
        content: 'hello',
        created: '2026-06-30T00:00:00.000Z'
      })
      await Promise.resolve()
    })

    expect(onMessageSent).toHaveBeenCalledTimes(1)
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

    const { textarea } = await renderChatInput({
      replyTarget,
      replySelectedText: 'orig',
      onCancelReply: vi.fn()
    })
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

  it('sends an image-only message from the plus menu', async () => {
    fetchMock.kunFetchPost
      .mockResolvedValueOnce({
        url: 'https://img.example/conversation/5/chat.webp',
        width: 800,
        height: 600,
        size: 5,
        mime: 'image/webp',
        name: 'chat.webp'
      })
      .mockResolvedValueOnce({
        id: 8,
        type: 1,
        content: '',
        image: {
          url: 'https://img.example/conversation/5/chat.webp',
          width: 800,
          height: 600,
          size: 5,
          mime: 'image/webp',
          name: 'chat.webp'
        },
        created: '2026-06-30T00:00:00.000Z'
      })

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

    const fileInput = container.querySelector<HTMLInputElement>(
      'input[type="file"]'
    )
    expect(fileInput).not.toBeNull()
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [new File(['image'], 'chat.webp', { type: 'image/webp' })]
    })

    await act(async () => {
      imageButton?.click()
      fileInput?.dispatchEvent(new dom!.window.Event('change', { bubbles: true }))
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

    expect(fetchMock.kunFetchPost).toHaveBeenNthCalledWith(
      1,
      '/message/conversation/5/image',
      expect.any(FormData)
    )
    expect(fetchMock.kunFetchPost).toHaveBeenNthCalledWith(
      2,
      '/message/conversation/5',
      expect.objectContaining({
        type: 1,
        image: expect.objectContaining({
          url: 'https://img.example/conversation/5/chat.webp'
        })
      })
    )
  })
})
