import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'

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
    onPress
  }: {
    children?: React.ReactNode
    isDisabled?: boolean
    isLoading?: boolean
    onPress?: () => void
  }) => (
    <button disabled={isDisabled || isLoading} onClick={onPress}>
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

  const renderChatInput = async () => {
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
        <ChatInput conversationId={5} onMessageSent={onMessageSent} />
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
})
