import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { PrivateMessage } from '~/types/api/conversation'

globalThis.React = React

const fetchMock = vi.hoisted(() => ({
  kunFetchFormData: vi.fn(),
  kunFetchGet: vi.fn(),
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

const motionMock = vi.hoisted(() => ({
  reducedMotion: false
}))

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="sticker-picker-presence">{children}</div>
  ),
  useIsPresent: () => true,
  useReducedMotion: () => motionMock.reducedMotion,
  motion: {
    div: React.forwardRef<
      HTMLDivElement,
      React.HTMLAttributes<HTMLDivElement> & {
        initial?: unknown
        animate?: unknown
        exit?: unknown
        transition?: unknown
      }
    >(({ initial, animate, exit, transition, children, ...props }, ref) => (
      <div
        {...props}
        ref={ref}
        data-motion-initial={JSON.stringify(initial)}
        data-motion-animate={JSON.stringify(animate)}
        data-motion-exit={JSON.stringify(exit)}
        data-motion-transition={JSON.stringify(transition)}
      >
        {children}
      </div>
    ))
  }
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchFormData: fetchMock.kunFetchFormData,
  kunFetchGet: fetchMock.kunFetchGet,
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
      endContent?: React.ReactNode
      classNames?: {
        innerWrapper?: string
        input?: string
      }
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
        placeholder,
        endContent,
        classNames
      },
      ref
    ) => {
      textareaMock.onValueChange = onValueChange
      textareaMock.onKeyDown = onKeyDown
      textareaMock.onCompositionStart = onCompositionStart
      textareaMock.onCompositionEnd = onCompositionEnd
      textareaMock.onPaste = onPaste

      return (
        <div
          data-testid="textarea-inner-wrapper"
          className={classNames?.innerWrapper}
        >
          <textarea
            aria-label="私聊输入"
            className={classNames?.input}
            ref={ref}
            placeholder={placeholder}
            value={value}
            onChange={(event) => onValueChange?.(event.target.value)}
            onKeyDown={onKeyDown}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            onPaste={onPaste}
          />
          {endContent}
        </div>
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
    className,
    onPress
  }: {
    children?: React.ReactNode
    isDisabled?: boolean
    isLoading?: boolean
    'aria-label'?: string
    className?: string
    onPress?: () => void
  }) => (
    <button
      aria-label={ariaLabel}
      className={className}
      disabled={isDisabled || isLoading}
      onClick={onPress}
    >
      {children}
    </button>
  ),
  Image: ({
    removeWrapper: _removeWrapper,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & {
    removeWrapper?: boolean
  }) => <img {...props} />
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
    }> = {},
    options: Partial<{
      isMobileViewport: boolean
      withStickerPickerPortal: boolean
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
    if (typeof options.isMobileViewport === 'boolean') {
      Object.defineProperty(dom.window, 'matchMedia', {
        configurable: true,
        value: vi.fn((query: string) => ({
          matches: options.isMobileViewport,
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn()
        }))
      })
    }
    vi.stubGlobal('URL', dom.window.URL)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const stickerPickerPortal = dom.window.document.createElement('div')
    stickerPickerPortal.dataset.testid = 'sticker-picker-portal'
    dom.window.document.body.append(stickerPickerPortal)
    const stickerPickerPortalRef = {
      current: stickerPickerPortal
    } as React.RefObject<HTMLDivElement | null>

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
            stickerPickerPortalRef={
              options.withStickerPickerPortal
                ? stickerPickerPortalRef
                : undefined
            }
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
      stickerPickerPortal,
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
    fetchMock.kunFetchGet.mockReset()
    fetchMock.kunFetchPost.mockReset()
    textareaMock.onValueChange = undefined
    textareaMock.onKeyDown = undefined
    textareaMock.onCompositionStart = undefined
    textareaMock.onCompositionEnd = undefined
    textareaMock.onPaste = undefined
    motionMock.reducedMotion = false
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

  it('uses a compact input placeholder on mobile viewports', async () => {
    const { textarea } = await renderChatInput({}, { isMobileViewport: true })

    expect(textarea.placeholder).toBe('输入消息...')
  })

  it('keeps the input placeholder on desktop viewports', async () => {
    const { textarea } = await renderChatInput({}, { isMobileViewport: false })

    expect(textarea.placeholder).toBe(
      '输入消息... (按 Enter 发送，Shift+Enter 换行)'
    )
  })

  it('embeds the sticker trigger at the right edge of the message input', async () => {
    const { container, textarea } = await renderChatInput()
    const inputInner = container.querySelector<HTMLElement>(
      '[data-testid="textarea-inner-wrapper"]'
    )
    const stickerButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="选择贴纸"]'
    )

    expect(inputInner).not.toBeNull()
    expect(inputInner?.contains(textarea)).toBe(true)
    expect(inputInner?.contains(stickerButton)).toBe(true)
    expect(inputInner?.lastElementChild?.contains(stickerButton)).toBe(true)
    expect(stickerButton?.parentElement?.className).toContain('absolute')
    expect(stickerButton?.parentElement?.className).toContain('bottom-1')
    expect(stickerButton?.parentElement?.className).toContain('right-2')
    expect(stickerButton?.parentElement?.className).not.toContain('self-end')
    expect(stickerButton?.parentElement?.className).not.toContain(
      'self-stretch'
    )
    expect(textarea.className).toContain('!pe-10')
  })

  it('keeps the mobile sticker picker in the lower half of the chat viewport', async () => {
    fetchMock.kunFetchGet.mockResolvedValueOnce({ packs: [] })

    const { container, stickerPickerPortal } = await renderChatInput(
      {},
      { isMobileViewport: true, withStickerPickerPortal: true }
    )
    const stickerButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="选择贴纸"]'
    )
    const stickerTrigger = stickerButton?.parentElement

    stickerPickerPortal.getBoundingClientRect = () =>
      ({
        left: 0,
        right: 1000,
        top: 0,
        bottom: 600,
        width: 1000,
        height: 600,
        x: 0,
        y: 0,
        toJSON: () => ({})
      }) as DOMRect
    stickerTrigger!.getBoundingClientRect = () =>
      ({
        left: 850,
        right: 882,
        top: 610,
        bottom: 642,
        width: 32,
        height: 32,
        x: 850,
        y: 610,
        toJSON: () => ({})
      }) as DOMRect

    await act(async () => {
      stickerButton?.click()
      await Promise.resolve()
    })

    const picker = stickerPickerPortal.querySelector<HTMLElement>(
      '[data-testid="sticker-picker"]'
    )
    expect(picker).not.toBeNull()
    expect(container.querySelector('[data-testid="sticker-picker"]')).toBeNull()
    expect(picker?.dataset.layout).toBe('chat-viewport')
    expect(picker?.className).toContain('max-lg:inset-x-0')
    expect(picker?.className).toContain('max-lg:bottom-0')
    expect(picker?.className).toContain('max-lg:h-1/2')
    expect(picker?.className).toContain('max-lg:w-full')
    expect(picker?.className).toContain('max-lg:rounded-none')
    expect(picker?.className).not.toContain('max-lg:inset-0')
    expect(picker?.className).not.toContain('max-lg:h-full')
    expect(picker?.className).not.toContain('calc(100vw-2rem)')
    expect(picker?.className).toContain('lg:w-3/5')
    expect(picker?.className).not.toContain('lg:w-[22rem]')
    expect(picker?.className).toContain(
      'lg:right-[var(--kun-sticker-picker-anchor-right)]'
    )
    expect(picker?.className).not.toContain('lg:left-4')
    expect(
      picker?.style.getPropertyValue('--kun-sticker-picker-anchor-right')
    ).toBe('118px')
  })

  it('pops the sticker picker in and configures a fade-out exit', async () => {
    fetchMock.kunFetchGet.mockResolvedValueOnce({ packs: [] })

    const { container, stickerPickerPortal } = await renderChatInput(
      {},
      { withStickerPickerPortal: true }
    )
    const stickerButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="选择贴纸"]'
    )

    await act(async () => {
      stickerButton?.click()
      await Promise.resolve()
    })

    const picker = stickerPickerPortal.querySelector<HTMLElement>(
      '[data-testid="sticker-picker"]'
    )
    const initial = JSON.parse(picker?.dataset.motionInitial ?? 'null')
    const animate = JSON.parse(picker?.dataset.motionAnimate ?? 'null')
    const exit = JSON.parse(picker?.dataset.motionExit ?? 'null')

    expect(
      container.querySelector('[data-testid="sticker-picker-presence"]')
    ).not.toBeNull()
    expect(initial).toEqual({ opacity: 0, y: 12, scale: 0.98 })
    expect(animate).toEqual({ opacity: 1, y: 0, scale: 1 })
    expect(exit).toEqual(
      expect.objectContaining({
        opacity: 0,
        transition: expect.objectContaining({ duration: 0.14 })
      })
    )
    expect(picker?.className).toContain('origin-bottom')
    expect(picker?.className).toContain('lg:origin-bottom-right')
  })

  it('disables sticker picker motion when reduced motion is preferred', async () => {
    motionMock.reducedMotion = true
    fetchMock.kunFetchGet.mockResolvedValueOnce({ packs: [] })

    const { container, stickerPickerPortal } = await renderChatInput(
      {},
      { withStickerPickerPortal: true }
    )
    const stickerButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="选择贴纸"]'
    )

    await act(async () => {
      stickerButton?.click()
      await Promise.resolve()
    })

    const picker = stickerPickerPortal.querySelector<HTMLElement>(
      '[data-testid="sticker-picker"]'
    )
    const exit = JSON.parse(picker?.dataset.motionExit ?? 'null')
    const transition = JSON.parse(picker?.dataset.motionTransition ?? 'null')

    expect(picker?.dataset.motionInitial).toBe('false')
    expect(exit.transition.duration).toBe(0)
    expect(transition.duration).toBe(0)
  })

  it('loads sticker packs and sends an independent sticker message', async () => {
    fetchMock.kunFetchGet.mockResolvedValueOnce({
      packs: [
        {
          id: 4,
          slug: 'moe',
          name: 'Moe',
          description: '',
          coverUrl: 'https://cdn.example/cover.webp',
          price: 0,
          status: 1,
          stickers: [
            {
              id: 'moe-wave',
              packId: 4,
              packSlug: 'moe',
              packName: 'Moe',
              url: 'https://cdn.example/wave.webm',
              thumbnailUrl: 'https://cdn.example/wave.webp',
              mime: 'video/webm',
              mediaType: 'video',
              width: 512,
              height: 512,
              size: 12000,
              durationMs: 1200,
              frameRate: 30,
              alt: '挥手'
            }
          ]
        }
      ]
    })
    fetchMock.kunFetchPost.mockResolvedValueOnce(
      sentMessage(8, '', {
        type: 2,
        stickerId: 'moe-wave',
        sticker: {
          id: 'moe-wave',
          packId: 4,
          packSlug: 'moe',
          packName: 'Moe',
          url: 'https://cdn.example/wave.webm',
          thumbnailUrl: 'https://cdn.example/wave.webp',
          mime: 'video/webm',
          mediaType: 'video',
          width: 512,
          height: 512,
          size: 12000,
          durationMs: 1200,
          frameRate: 30,
          alt: '挥手'
        }
      })
    )

    const { container, stickerPickerPortal } = await renderChatInput(
      {},
      { withStickerPickerPortal: true }
    )
    const stickerButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="选择贴纸"]'
    )
    expect(stickerButton).not.toBeNull()

    await act(async () => {
      stickerButton!.click()
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith('/message/stickers')
    const stickerOption = stickerPickerPortal.querySelector<HTMLButtonElement>(
      '[data-testid="sticker-option-moe-wave"]'
    )
    expect(stickerOption).not.toBeNull()
    expect(stickerOption?.parentElement?.className).toContain('grid-cols-5')
    expect(stickerOption?.parentElement?.className).not.toContain(
      'sm:grid-cols-6'
    )
    expect(stickerOption?.parentElement?.className).toContain(
      'lg:max-h-[calc(48cqw_+_1px)]'
    )
    expect(stickerOption?.parentElement?.className).not.toContain('lg:max-h-64')
    const stickerVideo = stickerOption?.querySelector<HTMLVideoElement>(
      '[data-testid="sticker-thumbnail-video"]'
    )
    expect(stickerVideo?.src).toBe('https://cdn.example/wave.webm')
    expect(stickerVideo?.muted).toBe(true)
    expect(stickerVideo?.loop).toBe(true)
    expect(
      stickerOption?.querySelector('[data-testid="sticker-thumbnail-poster"]')
    ).not.toBeNull()
    expect(
      stickerPickerPortal.querySelector('button[aria-label="切换到Moe"] video')
    ).toBeNull()

    await act(async () => {
      stickerOption!.click()
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchPost).toHaveBeenCalledWith(
      '/message/conversation/5',
      expect.objectContaining({
        type: 2,
        stickerId: 'moe-wave'
      })
    )
    expect(
      fetchMock.kunFetchPost.mock.calls.at(-1)?.[1]?.content
    ).toBeUndefined()
    expect(onMessageSent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 2, stickerId: 'moe-wave' })
    )
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
    expect(replyPreview?.className).toContain(
      'bg-[var(--kun-chat-reply-draft-bg)]'
    )
    expect(replyPreview?.className).toContain(
      'text-[var(--kun-chat-reply-text)]'
    )
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
      expect.any(FormData),
      undefined,
      { preserveErrorStatus: true }
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
    expect(attachmentMenu?.className).toContain('bg-[var(--kun-chat-menu-bg)]')
    expect(attachmentMenu?.className).toContain(
      'text-[var(--kun-chat-menu-text)]'
    )
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

  it('shows the upload status code and server reason when image upload fails', async () => {
    const toast = (await import('react-hot-toast')).default
    vi.mocked(toast.error).mockClear()
    fetchMock.kunFetchFormData.mockRejectedValueOnce(
      new Error('Kun Fetch error! Status: 413; Message: 图片大小不能超过 8 MB')
    )

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
    expect(fetchMock.kunFetchFormData).toHaveBeenCalledWith(
      '/message/conversation/5/image',
      expect.any(FormData),
      undefined,
      { preserveErrorStatus: true }
    )
    expect(toast.error).toHaveBeenCalledWith(
      '图片上传失败（错误码 413）：图片大小不能超过 8 MB'
    )
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
