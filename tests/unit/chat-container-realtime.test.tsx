import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { PrivateMessage } from '~/types/api/conversation'

globalThis.React = React

const fetchMock = vi.hoisted(() => ({
  kunFetchGet: vi.fn(),
  kunFetchPut: vi.fn()
}))

const chatInputMock = vi.hoisted(() => ({
  onMessageSent: undefined as
    | ((message: { id: number; content: string; created: string }) => void)
    | undefined
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
  Card: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  CardBody: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  CardHeader: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  )
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
    onMessageSent
  }: {
    onMessageSent: (message: {
      id: number
      content: string
      created: string
    }) => void
  }) => {
    chatInputMock.onMessageSent = onMessageSent
    return <div data-testid="chat-input" />
  }
}))

vi.mock('~/components/message/chat/DeleteConversationButton', () => ({
  DeleteConversationButton: () => <button data-testid="delete-conversation" />
}))

vi.mock('~/components/message/chat/ChatMessage', () => ({
  ChatMessage: ({ message }: { message: PrivateMessage }) => (
    <div data-message-id={message.id}>{message.content}</div>
  )
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
  content,
  status: 0,
  isDeleted: false,
  editedAt: null,
  created,
  sender
})

describe('ChatContainer realtime sync', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const renderChat = async (visibilityState = 'visible') => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    Object.defineProperty(dom.window.document, 'visibilityState', {
      configurable: true,
      value: visibilityState
    })
    vi.stubGlobal('IntersectionObserver', class {
      observe = vi.fn()
      disconnect = vi.fn()
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
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

    const initialMessages = [
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
          total={2}
          otherUser={otherUser}
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
    vi.stubGlobal('IntersectionObserver', class {
      observe = vi.fn()
      disconnect = vi.fn()
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
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
        content: 'my slightly later message',
        created: '2026-06-29T10:04:00.000Z'
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
