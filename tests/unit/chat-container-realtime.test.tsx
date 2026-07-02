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

const fetchMock = vi.hoisted(() => ({
  kunFetchGet: vi.fn(),
  kunFetchPut: vi.fn()
}))

const chatInputMock = vi.hoisted(() => ({
  onMessageSent: undefined as ((message: PrivateMessage) => void) | undefined,
  replyTargetId: null as number | null
}))

const intersectionMock = vi.hoisted(() => ({
  callback: undefined as IntersectionObserverCallback | undefined
}))

const imageViewerMock = vi.hoisted(() => ({
  images: [] as Array<{ src: string; alt: string }>,
  index: -1,
  onClose: undefined as (() => void) | undefined,
  onView: undefined as ((index: number) => void) | undefined
}))

const chatMessageMock = vi.hoisted(() => ({
  onMessageUpdatedById: new Map<
    number,
    (
      data:
        | { action: 'delete' }
        | { action: 'edit'; content: string; editedAt: string | Date }
    ) => void
  >(),
  onReplyById: new Map<
    number,
    (
      message: PrivateMessage,
      selectedText: string | null,
      imageIndex?: number | null
    ) => void
  >()
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: fetchMock.kunFetchGet,
  kunFetchPut: fetchMock.kunFetchPut
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className
  }: {
    children?: React.ReactNode
    href: string
    className?: string
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  )
}))

vi.mock('@heroui/card', () => ({
  Card: ({
    children,
    className
  }: {
    children?: React.ReactNode
    className?: string
  }) => <div className={className}>{children}</div>,
  CardBody: ({
    children,
    className
  }: {
    children?: React.ReactNode
    className?: string
  }) => <div className={className}>{children}</div>,
  CardHeader: ({
    children,
    className
  }: {
    children?: React.ReactNode
    className?: string
  }) => <div className={className}>{children}</div>
}))

vi.mock('@heroui/react', () => ({
  Button: ({
    children,
    as: Component = 'button',
    href,
    className
  }: {
    children?: React.ReactNode
    as?: React.ElementType
    href?: string
    className?: string
  }) => (
    <Component href={href} className={className}>
      {children}
    </Component>
  )
}))

vi.mock('~/components/kun/Null', () => ({
  KunNull: ({ message }: { message: string }) => <div>{message}</div>
}))

vi.mock('~/components/kun/floating-card/KunAvatar', () => ({
  KunAvatar: () => <div data-testid="avatar" />
}))

vi.mock('~/components/message/chat/ChatInput', () => ({
  ChatInput: ({
    onMessageSent,
    replyTarget
  }: {
    onMessageSent: (message: PrivateMessage) => void
    replyTarget?: PrivateMessage
  }) => {
    chatInputMock.onMessageSent = onMessageSent
    chatInputMock.replyTargetId = replyTarget?.id ?? null
    return <div data-testid="chat-input" />
  }
}))

vi.mock('~/components/message/chat/DeleteConversationButton', () => ({
  DeleteConversationButton: () => <button data-testid="delete-conversation" />
}))

vi.mock('~/components/message/chat/ChatMessage', () => ({
  ChatMessage: ({
    message,
    onReply,
    onOpenImage,
    onReplyPreviewClick,
    replyHighlight,
    isReplyHighlightFading,
    onMessageUpdated
  }: {
    message: PrivateMessage
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
    onMessageUpdated: (
      data:
        | { action: 'delete' }
        | { action: 'edit'; content: string; editedAt: string | Date }
    ) => void
  }) => {
    chatMessageMock.onMessageUpdatedById.set(message.id, onMessageUpdated)
    if (onReply) {
      chatMessageMock.onReplyById.set(message.id, onReply)
    }

    return (
      <div
        id={`chat-message-${message.id}`}
        data-message-id={message.id}
        data-status={message.status}
        data-deleted={String(message.isDeleted)}
        data-content={message.content}
        data-image-count={String(
          message.images?.length ?? (message.image ? 1 : 0)
        )}
        data-reply-preview={message.replyTo?.content ?? ''}
        data-highlight-kind={replyHighlight?.kind ?? ''}
        data-highlight-fading={
          replyHighlight ? String(Boolean(isReplyHighlightFading)) : ''
        }
        data-highlight-text={
          replyHighlight?.kind === 'text' ? replyHighlight.selectedText : ''
        }
      >
        {message.content}
        {message.replyTo && (
          <button
            data-testid={`reply-preview-${message.id}`}
            onClick={() => onReplyPreviewClick?.(message.replyTo!, message.id)}
          >
            reply preview
          </button>
        )}
        {(message.images?.length || message.image) && (
          <button
            data-testid={`open-image-${message.id}`}
            onClick={() => onOpenImage?.(message, 0)}
          >
            open image
          </button>
        )}
      </div>
    )
  }
}))

vi.mock('~/components/kun/image-viewer/ImageViewer', () => ({
  KunControlledImageViewer: ({
    images,
    index,
    onClose,
    onView
  }: {
    images: Array<{ src: string; alt: string }>
    index: number
    onClose: () => void
    onView: (index: number) => void
  }) => {
    imageViewerMock.images = images
    imageViewerMock.index = index
    imageViewerMock.onClose = onClose
    imageViewerMock.onView = onView
    return <div data-testid="chat-image-viewer" data-index={index} />
  }
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

const currentUser = {
  uid: 1007,
  name: 'Saya',
  avatar: '/saya.webp',
  bio: '',
  moemoepoint: 0,
  role: 1,
  dailyCheckIn: 0,
  dailyImageLimit: 0,
  dailyUploadLimit: 0,
  enableEmailNotice: true,
  allowPrivateMessage: true,
  blockedTagIds: [],
  enableRedirect: true,
  excludedDomains: [],
  delaySeconds: 5
}

const otherUser = {
  id: 8,
  name: 'Mio',
  avatar: '/mio.webp'
}

const message = (
  id: number,
  content: string,
  sender: KunUser,
  created = `2026-06-29T10:0${id}.000Z`
): PrivateMessage => ({
  id,
  type: 0,
  content,
  status: 0,
  isDeleted: false,
  image: null,
  replyTo: null,
  editedAt: null,
  created,
  sender
})

describe('ChatContainer realtime sync', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const renderChat = async (
    visibilityState = 'visible',
    options: {
      total?: number
      hasMoreBefore?: boolean
      initialMessages?: PrivateMessage[]
      className?: string
    } = {}
  ) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    Object.defineProperty(dom.window.document, 'visibilityState', {
      configurable: true,
      value: visibilityState
    })
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersectionMock.callback = callback
        }
        observe = vi.fn()
        disconnect = vi.fn()
      }
    )
    let animationFrameTime = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      animationFrameTime += 500
      callback(animationFrameTime)
      return animationFrameTime
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { useUserStore } = await import('~/store/userStore')
    const { useMessageStore } = await import('~/store/messageStore')
    useUserStore.setState({ user: currentUser })
    useMessageStore.setState(
      {
        ...useMessageStore.getState(),
        hasUnreadNotification: false,
        hasUnreadConversation: true
      },
      true
    )

    const initialMessages = options.initialMessages ?? [
      message(1, 'hello', otherUser, '2026-06-29T10:01:00.000Z'),
      message(2, 'hi', {
        id: currentUser.uid,
        name: currentUser.name,
        avatar: currentUser.avatar
      })
    ]

    const { ChatContainer } = await import(
      '~/components/message/chat/ChatContainer'
    )
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(
        <ChatContainer
          conversationId={5}
          initialMessages={initialMessages}
          total={options.total ?? 2}
          hasMoreBefore={options.hasMoreBefore}
          otherUser={otherUser}
          className={options.className}
        />
      )
    })

    return { container: container!, useMessageStore }
  }

  const renderEmptyChat = async (visibilityState = 'visible') => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    Object.defineProperty(dom.window.document, 'visibilityState', {
      configurable: true,
      value: visibilityState
    })
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersectionMock.callback = callback
        }
        observe = vi.fn()
        disconnect = vi.fn()
      }
    )
    let animationFrameTime = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      animationFrameTime += 500
      callback(animationFrameTime)
      return animationFrameTime
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { useUserStore } = await import('~/store/userStore')
    useUserStore.setState({ user: currentUser })

    const { ChatContainer } = await import(
      '~/components/message/chat/ChatContainer'
    )
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(
        <ChatContainer
          conversationId={5}
          initialMessages={[]}
          total={0}
          hasMoreBefore={false}
          otherUser={otherUser}
        />
      )
    })

    return { container: container! }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.kunFetchGet.mockResolvedValue({
      messages: [],
      total: 2,
      hasMoreBefore: false,
      otherUser
    })
    fetchMock.kunFetchPut.mockResolvedValue({
      hasUnreadNotification: false,
      hasUnreadConversation: false
    })
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.resetModules()
    fetchMock.kunFetchGet.mockReset()
    fetchMock.kunFetchPut.mockReset()
    chatInputMock.onMessageSent = undefined
    chatInputMock.replyTargetId = null
    intersectionMock.callback = undefined
    imageViewerMock.images = []
    imageViewerMock.index = -1
    imageViewerMock.onClose = undefined
    imageViewerMock.onView = undefined
    chatMessageMock.onMessageUpdatedById.clear()
    chatMessageMock.onReplyById.clear()
  })

  it('loads older history with beforeId instead of page skip', async () => {
    await renderChat('visible', { total: 3, hasMoreBefore: true })
    await act(async () => {
      await Promise.resolve()
    })
    fetchMock.kunFetchGet.mockClear()
    fetchMock.kunFetchGet.mockResolvedValueOnce({
      messages: [message(0, 'older', otherUser, '2026-06-29T10:00:00.000Z')],
      total: 1,
      hasMoreBefore: false,
      otherUser
    })

    await act(async () => {
      intersectionMock.callback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      )
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith(
      '/message/conversation/5',
      { page: 1, limit: 30, beforeId: 1 }
    )
  })

  it('keeps the chat input panel above message image stacking layers', async () => {
    const { container } = await renderChat()

    const chatInput = container.querySelector('[data-testid="chat-input"]')
    const inputPanel = chatInput?.parentElement

    expect(inputPanel?.className).toContain('relative')
    expect(inputPanel?.className).toContain('z-30')
  })

  it('preserves the existing chat card shell while messages scroll internally', async () => {
    const { container } = await renderChat()

    const chatCard = container.firstElementChild
    const messageScroller = container.querySelector('.overflow-y-auto')

    expect(chatCard?.className).toContain('h-[calc(100vh-200px)]')
    expect(chatCard?.className).toContain('min-h-[500px]')
    expect(chatCard?.className).not.toContain('h-full')
    expect(messageScroller?.className).toContain('flex-1')
    expect(messageScroller?.className).toContain('overflow-y-auto')
  })

  it('allows the conversation page to tune only the outer chat card height', async () => {
    const { container } = await renderChat('visible', {
      className: 'h-[calc(100dvh_-_192px_-_var(--message-chat-top-reserve))]'
    })

    const chatCard = container.firstElementChild
    const messageScroller = container.querySelector('.overflow-y-auto')

    expect(chatCard?.className).toContain(
      'h-[calc(100dvh_-_192px_-_var(--message-chat-top-reserve))]'
    )
    expect(chatCard?.className).not.toContain('h-[calc(100vh-200px)]')
    expect(chatCard?.className).toContain('min-h-[500px]')
    expect(messageScroller?.className).toContain('flex-1')
    expect(messageScroller?.className).toContain('overflow-y-auto')
  })

  it('recovers from older history load failures so users can retry', async () => {
    await renderChat('visible', { total: 3, hasMoreBefore: true })
    await act(async () => {
      await Promise.resolve()
    })
    fetchMock.kunFetchGet.mockClear()
    fetchMock.kunFetchGet.mockRejectedValueOnce(new Error('network down'))
    const toast = (await import('react-hot-toast')).default

    await act(async () => {
      intersectionMock.callback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      )
      await Promise.resolve()
    })

    expect(toast.error).toHaveBeenCalledWith('获取历史消息失败，请稍后重试')
    expect(dom?.window.document.querySelector('.animate-spin')).toBeNull()
  })

  it('does not start overlapping older history loads for the same cursor', async () => {
    let resolveOlderHistory:
      | ((response: {
          messages: PrivateMessage[]
          total: number
          hasMoreBefore: boolean
          otherUser: KunUser
        }) => void)
      | undefined

    await renderChat('visible', { total: 3, hasMoreBefore: true })
    await act(async () => {
      await Promise.resolve()
    })
    fetchMock.kunFetchGet.mockClear()
    fetchMock.kunFetchGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOlderHistory = resolve
        })
    )

    await act(async () => {
      intersectionMock.callback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      )
      intersectionMock.callback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      )
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchGet).toHaveBeenCalledTimes(1)
    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith(
      '/message/conversation/5',
      { page: 1, limit: 30, beforeId: 1 }
    )

    await act(async () => {
      resolveOlderHistory?.({
        messages: [message(0, 'older', otherUser, '2026-06-29T10:00:00.000Z')],
        total: 1,
        hasMoreBefore: false,
        otherUser
      })
      await Promise.resolve()
    })
  })

  it('opens a conversation-wide image lightbox from a single image message', async () => {
    const initialMessages: PrivateMessage[] = [
      {
        ...message(1, '', otherUser, '2026-06-29T10:01:00.000Z'),
        type: 1,
        images: [
          {
            url: 'https://img.example/a.avif',
            width: 800,
            height: 600,
            size: 1,
            mime: 'image/avif',
            name: 'a.avif'
          },
          {
            url: 'https://img.example/b.avif',
            width: 800,
            height: 600,
            size: 1,
            mime: 'image/avif',
            name: 'b.avif'
          }
        ],
        image: {
          url: 'https://img.example/a.avif',
          width: 800,
          height: 600,
          size: 1,
          mime: 'image/avif',
          name: 'a.avif'
        }
      },
      {
        ...message(2, '', {
          id: currentUser.uid,
          name: currentUser.name,
          avatar: currentUser.avatar
        }),
        type: 1,
        image: {
          url: 'https://img.example/c.avif',
          width: 600,
          height: 900,
          size: 1,
          mime: 'image/avif',
          name: 'c.avif'
        }
      }
    ]

    const { container } = await renderChat('visible', {
      total: 2,
      initialMessages
    })

    expect(imageViewerMock.images.map((image) => image.src)).toEqual([
      'https://img.example/a.avif',
      'https://img.example/b.avif',
      'https://img.example/c.avif'
    ])

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="open-image-2"]')
        ?.click()
      await Promise.resolve()
    })

    expect(imageViewerMock.index).toBe(2)
  })

  it('scrolls to the referenced message and highlights the replied text when a reply preview is clicked', async () => {
    const scrollIntoView = vi.fn()
    const initialMessages: PrivateMessage[] = [
      message(1, 'hello original world', otherUser, '2026-06-29T10:01:00.000Z'),
      {
        ...message(2, 'reply', {
          id: currentUser.uid,
          name: currentUser.name,
          avatar: currentUser.avatar
        }),
        replyTo: {
          messageId: 1,
          content: 'hello original world',
          senderName: 'Mio',
          selectedText: 'original'
        }
      }
    ]
    const { container } = await renderChat('visible', {
      total: 2,
      initialMessages
    })
    Object.defineProperty(dom!.window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView
    })

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="reply-preview-2"]')
        ?.click()
      await Promise.resolve()
    })

    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(
      container
        .querySelector('[data-message-id="1"]')
        ?.getAttribute('data-highlight-kind')
    ).toBe('')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(499)
    })

    expect(
      container
        .querySelector('[data-message-id="1"]')
        ?.getAttribute('data-highlight-kind')
    ).toBe('')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(
      container
        .querySelector('[data-message-id="1"]')
        ?.getAttribute('data-highlight-kind')
    ).toBe('text')
    expect(
      container
        .querySelector('[data-message-id="1"]')
        ?.getAttribute('data-highlight-text')
    ).toBe('original')
    expect(
      container
        .querySelector('[data-message-id="1"]')
        ?.getAttribute('data-highlight-fading')
    ).toBe('false')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })

    expect(
      container
        .querySelector('[data-message-id="1"]')
        ?.getAttribute('data-highlight-fading')
    ).toBe('true')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(260)
    })

    expect(
      container
        .querySelector('[data-message-id="1"]')
        ?.getAttribute('data-highlight-kind')
    ).toBe('')
  })

  it('polls visible chat windows every 2 seconds for newer messages', async () => {
    await renderChat()
    await act(async () => {
      await Promise.resolve()
    })
    fetchMock.kunFetchGet.mockClear()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith(
      '/message/conversation/5',
      { page: 1, limit: 50, afterId: 2 }
    )
  })

  it('polls an empty conversation so the first incoming message appears', async () => {
    await renderEmptyChat()
    await act(async () => {
      await Promise.resolve()
    })
    fetchMock.kunFetchGet.mockClear()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith(
      '/message/conversation/5',
      { page: 1, limit: 50 }
    )
  })

  it('does not start overlapping realtime polls when visibility changes during an in-flight refresh', async () => {
    let resolveRealtimePoll:
      | ((response: {
          messages: PrivateMessage[]
          total: number
          hasMoreBefore: boolean
          otherUser: KunUser
        }) => void)
      | undefined

    fetchMock.kunFetchGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRealtimePoll = resolve
        })
    )

    await renderEmptyChat('visible')
    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchGet).toHaveBeenCalledTimes(1)

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    })

    await act(async () => {
      document.dispatchEvent(new dom!.window.Event('visibilitychange'))
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchGet).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveRealtimePoll?.({
        messages: [],
        total: 0,
        hasMoreBefore: false,
        otherUser
      })
      await Promise.resolve()
    })
  })

  it('refreshes messages immediately after opening a prefetched chat page', async () => {
    await renderChat()

    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith(
      '/message/conversation/5',
      { page: 1, limit: 50, afterId: 2 }
    )
  })

  it('shows a retryable error when opening-chat read sync throws', async () => {
    fetchMock.kunFetchPut.mockRejectedValueOnce(new Error('network down'))
    const toast = (await import('react-hot-toast')).default
    vi.mocked(toast.error).mockClear()

    const { container } = await renderChat()
    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchPut).toHaveBeenCalledWith(
      '/message/conversation/5/read'
    )
    expect(toast.error).toHaveBeenCalledWith('同步私聊已读状态失败，请稍后重试')
    expect(container.textContent).toContain('hello')
  })

  it('merges new messages without duplicates and marks other-user messages read', async () => {
    const { container, useMessageStore } = await renderChat()
    await act(async () => {
      await Promise.resolve()
    })
    fetchMock.kunFetchGet.mockClear()
    fetchMock.kunFetchGet.mockResolvedValueOnce({
      messages: [
        message(2, 'hi duplicate', {
          id: currentUser.uid,
          name: currentUser.name,
          avatar: currentUser.avatar
        }),
        message(3, 'fresh message', otherUser, '2026-06-29T10:03:00.000Z')
      ],
      total: 3,
      otherUser
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(container.querySelectorAll('[data-message-id="2"]')).toHaveLength(1)
    expect(container.textContent).toContain('fresh message')
    expect(fetchMock.kunFetchPut).toHaveBeenCalledWith(
      '/message/conversation/5/read'
    )
    expect(useMessageStore.getState().hasUnreadConversation).toBe(false)
  })

  it('shows a retryable error and keeps polling when realtime read sync throws', async () => {
    const toast = (await import('react-hot-toast')).default
    vi.mocked(toast.error).mockClear()

    const { container } = await renderChat()
    await act(async () => {
      await Promise.resolve()
    })

    fetchMock.kunFetchGet.mockClear()
    fetchMock.kunFetchPut.mockClear()
    fetchMock.kunFetchPut.mockRejectedValueOnce(new Error('network down'))
    fetchMock.kunFetchGet
      .mockResolvedValueOnce({
        messages: [
          message(3, 'fresh message', otherUser, '2026-06-29T10:03:00.000Z')
        ],
        total: 3,
        hasMoreBefore: false,
        otherUser
      })
      .mockResolvedValueOnce({
        messages: [],
        total: 3,
        hasMoreBefore: false,
        otherUser
      })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(container.textContent).toContain('fresh message')
    expect(toast.error).toHaveBeenCalledWith('同步私聊已读状态失败，请稍后重试')
    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith(
      '/message/conversation/5',
      { page: 1, limit: 50, beforeId: 4 }
    )
  })

  it('does not force-scroll to bottom when realtime messages arrive while reading history', async () => {
    const { container } = await renderChat()
    await act(async () => {
      await Promise.resolve()
    })
    fetchMock.kunFetchGet.mockClear()
    fetchMock.kunFetchGet.mockResolvedValueOnce({
      messages: [
        message(3, 'fresh message', otherUser, '2026-06-29T10:03:00.000Z')
      ],
      total: 3,
      hasMoreBefore: false,
      otherUser
    })
    const scrollContainer =
      container.querySelector<HTMLDivElement>('.overflow-y-auto')
    expect(scrollContainer).not.toBeNull()
    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, writable: true, value: 120 }
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(container.textContent).toContain('fresh message')
    expect(scrollContainer!.scrollTop).toBe(120)
  })

  it('shows a floating button away from the bottom and animates back to the live edge', async () => {
    const { container } = await renderChat()
    await act(async () => {
      await Promise.resolve()
    })

    const scrollContainer =
      container.querySelector<HTMLDivElement>('.overflow-y-auto')
    expect(scrollContainer).not.toBeNull()
    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, writable: true, value: 120 }
    })

    await act(async () => {
      scrollContainer!.dispatchEvent(new dom!.window.Event('scroll'))
      await Promise.resolve()
    })

    const scrollButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="回到底部"]'
    )
    expect(scrollButton).not.toBeNull()
    expect(scrollButton?.className).not.toContain('active:scale')
    expect(scrollButton?.className).not.toContain('transform')

    const originalRequestAnimationFrame = globalThis.requestAnimationFrame
    const requestAnimationFrameSpy = vi.fn((callback: FrameRequestCallback) =>
      originalRequestAnimationFrame(callback)
    )
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameSpy)

    await act(async () => {
      scrollButton!.click()
      await Promise.resolve()
    })

    expect(requestAnimationFrameSpy).toHaveBeenCalled()
    expect(scrollContainer!.scrollTop).toBe(700)
    expect(
      container
        .querySelector('[data-testid="chat-scroll-button-shell"]')
        ?.getAttribute('data-state')
    ).toBe('closed')
    expect(
      container.querySelector('[data-testid="chat-scroll-button-shell"]')
        ?.className
    ).not.toContain('translate-y')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(180)
    })

    expect(container.querySelector('button[aria-label="回到底部"]')).toBeNull()
  })

  it('keeps the scroll button mounted briefly while fading out', async () => {
    const { container } = await renderChat()
    await act(async () => {
      await Promise.resolve()
    })

    const scrollContainer =
      container.querySelector<HTMLDivElement>('.overflow-y-auto')
    expect(scrollContainer).not.toBeNull()
    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, writable: true, value: 120 }
    })

    await act(async () => {
      scrollContainer!.dispatchEvent(new dom!.window.Event('scroll'))
      await Promise.resolve()
    })

    expect(
      container
        .querySelector('[data-testid="chat-scroll-button-shell"]')
        ?.getAttribute('data-state')
    ).toBe('open')

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="回到底部"]')
        ?.click()
      await Promise.resolve()
    })

    const fadingShell = container.querySelector(
      '[data-testid="chat-scroll-button-shell"]'
    )
    expect(fadingShell?.getAttribute('data-state')).toBe('closed')
    expect(fadingShell?.className).not.toContain('translate-y')
    expect(
      container
        .querySelector<HTMLButtonElement>('button[aria-label="回到底部"]')
        ?.getAttribute('tabindex')
    ).toBe('-1')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(180)
    })

    expect(
      container.querySelector('[data-testid="chat-scroll-button-shell"]')
    ).toBeNull()
  })

  it('starts fading the scroll button immediately while the animated bottom scroll continues', async () => {
    const { container } = await renderChat()
    await act(async () => {
      await Promise.resolve()
    })

    const scrollContainer =
      container.querySelector<HTMLDivElement>('.overflow-y-auto')
    expect(scrollContainer).not.toBeNull()
    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, writable: true, value: 120 }
    })

    await act(async () => {
      scrollContainer!.dispatchEvent(new dom!.window.Event('scroll'))
      await Promise.resolve()
    })

    const frameCallbacks: FrameRequestCallback[] = []
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })
    )

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="回到底部"]')
        ?.click()
      await Promise.resolve()
    })

    expect(frameCallbacks).toHaveLength(1)
    expect(
      container
        .querySelector('[data-testid="chat-scroll-button-shell"]')
        ?.getAttribute('data-state')
    ).toBe('closed')
    expect(
      container.querySelector('[data-testid="chat-scroll-button-shell"]')
        ?.className
    ).not.toContain('translate-y')

    await act(async () => {
      frameCallbacks.shift()?.(0)
      await Promise.resolve()
    })

    expect(
      container
        .querySelector('[data-testid="chat-scroll-button-shell"]')
        ?.getAttribute('data-state')
    ).toBe('closed')

    await act(async () => {
      frameCallbacks.shift()?.(300)
      scrollContainer!.dispatchEvent(new dom!.window.Event('scroll'))
      await Promise.resolve()
    })

    expect(scrollContainer!.scrollTop).toBeGreaterThan(604)
    expect(
      container
        .querySelector('[data-testid="chat-scroll-button-shell"]')
        ?.getAttribute('data-state')
    ).toBe('closed')

    await act(async () => {
      frameCallbacks.shift()?.(420)
      await Promise.resolve()
    })

    expect(scrollContainer!.scrollTop).toBe(700)
    expect(
      container
        .querySelector('[data-testid="chat-scroll-button-shell"]')
        ?.getAttribute('data-state')
    ).toBe('closed')
  })

  it('returns to the reply preview origin before using the floating button as a normal bottom jump', async () => {
    const initialMessages: PrivateMessage[] = [
      message(1, 'hello original world', otherUser, '2026-06-29T10:01:00.000Z'),
      {
        ...message(2, 'reply', {
          id: currentUser.uid,
          name: currentUser.name,
          avatar: currentUser.avatar
        }),
        replyTo: {
          messageId: 1,
          content: 'hello original world',
          senderName: 'Mio',
          selectedText: 'original'
        }
      }
    ]
    const { container } = await renderChat('visible', {
      total: 2,
      initialMessages
    })
    const scrollContainer =
      container.querySelector<HTMLDivElement>('.overflow-y-auto')
    expect(scrollContainer).not.toBeNull()
    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, writable: true, value: 500 }
    })

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="reply-preview-2"]')
        ?.click()
      await Promise.resolve()
    })

    const replyReturnButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="回到回复消息位置"]'
    )
    expect(replyReturnButton).not.toBeNull()

    await act(async () => {
      replyReturnButton!.click()
      await Promise.resolve()
    })

    expect(scrollContainer!.scrollTop).toBe(500)
    expect(
      container.querySelector('button[aria-label="回到回复消息位置"]')
    ).toBeNull()

    const bottomButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="回到底部"]'
    )
    expect(bottomButton).not.toBeNull()

    await act(async () => {
      bottomButton!.click()
      await Promise.resolve()
    })

    expect(scrollContainer!.scrollTop).toBe(700)
    expect(
      container
        .querySelector('[data-testid="chat-scroll-button-shell"]')
        ?.getAttribute('data-state')
    ).toBe('closed')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(180)
    })

    expect(container.querySelector('button[aria-label="回到底部"]')).toBeNull()
  })

  it('highlights the reply preview origin message after returning to it', async () => {
    const initialMessages: PrivateMessage[] = [
      message(1, 'hello original world', otherUser, '2026-06-29T10:01:00.000Z'),
      {
        ...message(2, 'reply', {
          id: currentUser.uid,
          name: currentUser.name,
          avatar: currentUser.avatar
        }),
        replyTo: {
          messageId: 1,
          content: 'hello original world',
          senderName: 'Mio',
          selectedText: 'original'
        }
      }
    ]
    const { container } = await renderChat('visible', {
      total: 2,
      initialMessages
    })
    const scrollContainer =
      container.querySelector<HTMLDivElement>('.overflow-y-auto')
    expect(scrollContainer).not.toBeNull()
    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, writable: true, value: 500 }
    })

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="reply-preview-2"]')
        ?.click()
      await Promise.resolve()
    })

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="回到回复消息位置"]'
        )
        ?.click()
      await Promise.resolve()
    })

    expect(
      container
        .querySelector('[data-message-id="2"]')
        ?.getAttribute('data-highlight-kind')
    ).toBe('')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(
      container
        .querySelector('[data-message-id="2"]')
        ?.getAttribute('data-highlight-kind')
    ).toBe('bubble')
    expect(
      container
        .querySelector('[data-message-id="2"]')
        ?.getAttribute('data-highlight-fading')
    ).toBe('false')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })

    expect(
      container
        .querySelector('[data-message-id="2"]')
        ?.getAttribute('data-highlight-fading')
    ).toBe('true')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(260)
    })

    expect(
      container
        .querySelector('[data-message-id="2"]')
        ?.getAttribute('data-highlight-kind')
    ).toBe('')
  })

  it('keeps the reply preview return target when the origin is already near the bottom', async () => {
    const initialMessages: PrivateMessage[] = [
      message(1, 'hello original world', otherUser, '2026-06-29T10:01:00.000Z'),
      {
        ...message(2, 'reply', {
          id: currentUser.uid,
          name: currentUser.name,
          avatar: currentUser.avatar
        }),
        replyTo: {
          messageId: 1,
          content: 'hello original world',
          senderName: 'Mio',
          selectedText: 'original'
        }
      }
    ]
    const { container } = await renderChat('visible', {
      total: 2,
      initialMessages
    })
    const scrollContainer =
      container.querySelector<HTMLDivElement>('.overflow-y-auto')
    expect(scrollContainer).not.toBeNull()
    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, writable: true, value: 650 }
    })

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="reply-preview-2"]')
        ?.click()
      await Promise.resolve()
    })

    const replyReturnButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="回到回复消息位置"]'
    )
    expect(replyReturnButton).not.toBeNull()

    await act(async () => {
      replyReturnButton!.click()
      await Promise.resolve()
    })

    expect(scrollContainer!.scrollTop).toBe(650)
    expect(
      container.querySelector('button[aria-label="回到回复消息位置"]')
    ).toBeNull()

    expect(
      container
        .querySelector('[data-testid="chat-scroll-button-shell"]')
        ?.getAttribute('data-state')
    ).toBe('closed')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(180)
    })

    expect(container.querySelector('button[aria-label="回到底部"]')).toBeNull()
  })

  it('refreshes own message read status even when no newer messages arrive', async () => {
    const { container } = await renderChat()
    await act(async () => {
      await Promise.resolve()
    })
    fetchMock.kunFetchGet.mockClear()
    fetchMock.kunFetchGet
      .mockResolvedValueOnce({
        messages: [],
        total: 0,
        hasMoreBefore: false,
        otherUser
      })
      .mockResolvedValueOnce({
        messages: [
          message(
            2,
            'hi',
            {
              id: currentUser.uid,
              name: currentUser.name,
              avatar: currentUser.avatar
            },
            '2026-06-29T10:02:00.000Z'
          )
        ].map((msg) => ({ ...msg, status: 1 })),
        total: 1,
        hasMoreBefore: false,
        otherUser
      })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith(
      '/message/conversation/5',
      { page: 1, limit: 50, beforeId: 3 }
    )
    expect(
      container
        .querySelector('[data-message-id="2"]')
        ?.getAttribute('data-status')
    ).toBe('1')
  })

  it('keeps the realtime cursor on the last server-synced message after sending locally', async () => {
    fetchMock.kunFetchGet
      .mockResolvedValueOnce({
        messages: [],
        total: 2,
        otherUser
      })
      .mockImplementation((_url: string, query?: Record<string, number>) =>
        Promise.resolve({
          messages:
            query?.afterId === 2
              ? [
                  message(
                    3,
                    'other slightly earlier message',
                    otherUser,
                    '2026-06-29T10:03:00.000Z'
                  )
                ]
              : [],
          total: 1,
          hasMoreBefore: false,
          otherUser
        })
      )

    const { container } = await renderChat()
    await act(async () => {
      await Promise.resolve()
    })
    fetchMock.kunFetchGet.mockClear()

    await act(async () => {
      chatInputMock.onMessageSent?.({
        id: 4,
        type: 0,
        content: 'my slightly later message',
        status: 0,
        isDeleted: false,
        image: null,
        replyTo: null,
        editedAt: null,
        created: '2026-06-29T10:04:00.000Z',
        sender: {
          id: currentUser.uid,
          name: currentUser.name,
          avatar: currentUser.avatar
        }
      })
    })

    expect(container.textContent).toContain('my slightly later message')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith(
      '/message/conversation/5',
      { page: 1, limit: 50, afterId: 2 }
    )
    expect(container.textContent).toContain('other slightly earlier message')
  })

  it('turns locally deleted messages into tombstones without retaining stale payload', async () => {
    const initialMessages: PrivateMessage[] = [
      {
        ...message(1, 'private caption', otherUser, '2026-06-29T10:01:00.000Z'),
        type: 1,
        image: {
          url: 'https://img.example/private.avif',
          width: 800,
          height: 600,
          size: 1,
          mime: 'image/avif',
          name: 'private.avif'
        },
        images: [
          {
            url: 'https://img.example/private.avif',
            width: 800,
            height: 600,
            size: 1,
            mime: 'image/avif',
            name: 'private.avif'
          }
        ],
        replyTo: {
          messageId: 0,
          content: 'quoted private text',
          senderName: 'Mio',
          selectedText: 'quoted private text'
        }
      }
    ]

    const { container } = await renderChat('visible', {
      total: 1,
      initialMessages
    })

    await act(async () => {
      chatMessageMock.onMessageUpdatedById.get(1)?.({ action: 'delete' })
      await Promise.resolve()
    })

    const deletedMessage = container.querySelector('[data-message-id="1"]')
    expect(deletedMessage?.getAttribute('data-deleted')).toBe('true')
    expect(deletedMessage?.getAttribute('data-content')).toBe('')
    expect(deletedMessage?.getAttribute('data-image-count')).toBe('0')
    expect(deletedMessage?.getAttribute('data-reply-preview')).toBe('')
    expect(container.textContent).not.toContain('private caption')
    expect(imageViewerMock.images).toEqual([])
  })

  it('clears a reply draft when the referenced message is locally deleted', async () => {
    const { container } = await renderChat('visible', {
      total: 2,
      initialMessages: [
        message(1, 'reply target', otherUser, '2026-06-29T10:01:00.000Z'),
        message(2, 'other message', {
          id: currentUser.uid,
          name: currentUser.name,
          avatar: currentUser.avatar
        })
      ]
    })

    await act(async () => {
      const replyTarget = container.querySelector('[data-message-id="1"]')
      expect(replyTarget).not.toBeNull()
      chatMessageMock.onReplyById.get(1)?.(
        message(1, 'reply target', otherUser, '2026-06-29T10:01:00.000Z'),
        null
      )
      await Promise.resolve()
    })

    expect(chatInputMock.replyTargetId).toBe(1)

    await act(async () => {
      chatMessageMock.onMessageUpdatedById.get(1)?.({ action: 'delete' })
      await Promise.resolve()
    })

    expect(chatInputMock.replyTargetId).toBeNull()
  })

  it('backs off polling while the chat tab is hidden', async () => {
    await renderChat('hidden')
    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchGet).not.toHaveBeenCalled()

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(fetchMock.kunFetchGet).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(13_000)
    })

    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith(
      '/message/conversation/5',
      { page: 1, limit: 50, afterId: 2 }
    )
  })

  it('refreshes immediately when a hidden chat tab becomes visible', async () => {
    await renderChat('hidden')
    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchGet).not.toHaveBeenCalled()

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    })

    await act(async () => {
      document.dispatchEvent(new dom!.window.Event('visibilitychange'))
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith(
      '/message/conversation/5',
      { page: 1, limit: 50, afterId: 2 }
    )
  })
})
