import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { Conversation } from '~/types/api/conversation'

globalThis.React = React

const fetchMock = vi.hoisted(() => ({
  kunFetchGet: vi.fn()
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: fetchMock.kunFetchGet
}))

vi.mock('~/hooks/useMounted', () => ({
  useMounted: () => true
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
    prefetch,
    ...props
  }: {
    children?: React.ReactNode
    href: string
    className?: string
    prefetch?: boolean
    [key: string]: unknown
  }) => (
    <a
      href={href}
      className={className}
      data-prefetch={String(prefetch)}
      {...props}
    >
      {children}
    </a>
  )
}))

vi.mock('@heroui/card', () => ({
  Card: ({
    children,
    as: Component = 'a',
    href,
    className,
    prefetch
  }: {
    children?: React.ReactNode
    as?: React.ElementType
    href?: string
    className?: string
    prefetch?: boolean
  }) => (
    <Component
      href={href}
      className={className}
      data-testid="conversation-link"
      prefetch={prefetch}
    >
      {children}
    </Component>
  ),
  CardBody: ({
    children,
    className
  }: {
    children?: React.ReactNode
    className?: string
  }) => <div className={className}>{children}</div>
}))

vi.mock('@heroui/chip', () => ({
  Chip: ({ children }: { children?: React.ReactNode }) => (
    <span data-testid="unread-chip">{children}</span>
  )
}))

vi.mock('~/components/kun/Loading', () => ({
  KunLoading: ({ hint }: { hint: string }) => <div>{hint}</div>
}))

vi.mock('~/components/kun/Null', () => ({
  KunNull: ({ message }: { message: string }) => <div>{message}</div>
}))

vi.mock('~/components/kun/Pagination', () => ({
  KunPagination: ({
    total,
    page,
    onPageChange
  }: {
    total: number
    page: number
    onPageChange: (page: number) => void
  }) => (
    <div data-testid="pagination" data-total={total}>
      <button data-testid="next-page" onClick={() => onPageChange(page + 1)}>
        next
      </button>
    </div>
  )
}))

vi.mock('~/components/kun/floating-card/KunAvatar', () => ({
  KunAvatar: () => <div data-testid="avatar" />
}))

vi.mock('~/utils/time', () => ({
  formatTimeDifference: () => '刚刚'
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn()
  }
}))

const conversation = (
  unreadCount: number,
  lastMessage = 'hello'
): Conversation => ({
  id: 5,
  otherUser: { id: 8, name: 'Mio', avatar: '/mio.webp' },
  lastMessage,
  lastMessageTime: '2026-06-29T10:00:00.000Z',
  unreadCount
})

describe('ConversationList realtime refresh', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const renderList = async (
    hasUnreadConversation = false,
    options: { total?: number } = {}
  ) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { useMessageStore } = await import('~/store/messageStore')
    useMessageStore.setState(
      {
        ...useMessageStore.getState(),
        hasUnreadNotification: false,
        hasUnreadConversation
      },
      true
    )

    const { ConversationList } = await import(
      '~/components/message/chat/ConversationList'
    )
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(
        <ConversationList
          initialConversations={[conversation(0)]}
          total={options.total ?? 1}
        />
      )
    })

    return { container: container!, useMessageStore }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.kunFetchGet.mockResolvedValue({
      conversations: [conversation(0)],
      total: 1
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
  })

  it('keeps the initial conversation page visible while the background refresh is pending', async () => {
    fetchMock.kunFetchGet.mockReturnValue(new Promise(() => {}))

    const { container } = await renderList()

    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith(
      '/message/conversation',
      {
        page: 1,
        limit: 30
      }
    )
    expect(container.textContent).toContain('hello')
    expect(container.textContent).not.toContain('正在获取会话列表...')
  })

  it('refreshes the first conversation page in the background after hydration', async () => {
    fetchMock.kunFetchGet.mockResolvedValue({
      conversations: [conversation(0, 'fresh preview')],
      total: 1
    })

    const { container } = await renderList()

    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith(
      '/message/conversation',
      {
        page: 1,
        limit: 30
      }
    )
    expect(container.textContent).toContain('fresh preview')
    expect(container.textContent).not.toContain('hello')
  })

  it('refreshes the current conversation page and syncs unread state', async () => {
    const { container, useMessageStore } = await renderList()

    fetchMock.kunFetchGet.mockResolvedValueOnce({
      conversations: [conversation(3, 'fresh')],
      total: 1
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })

    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith(
      '/message/conversation',
      {
        page: 1,
        limit: 30
      }
    )
    expect(container.textContent).toContain('fresh')
    expect(
      container.querySelector('[data-testid="unread-chip"]')?.textContent
    ).toBe('3')
    expect(useMessageStore.getState().hasUnreadConversation).toBe(true)
  })

  it('does not clear the global unread dot when the current page has no unread conversations', async () => {
    const { useMessageStore } = await renderList(true)

    fetchMock.kunFetchGet.mockResolvedValueOnce({
      conversations: [conversation(0, 'current page read')],
      total: 31
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })

    expect(useMessageStore.getState().hasUnreadConversation).toBe(true)
  })

  it('updates pagination when background refresh changes the total conversation count', async () => {
    const { container } = await renderList()
    expect(container.querySelector('[data-testid="pagination"]')).toBeNull()

    fetchMock.kunFetchGet.mockResolvedValueOnce({
      conversations: [conversation(0, 'new page count')],
      total: 31
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })

    expect(
      container
        .querySelector('[data-testid="pagination"]')
        ?.getAttribute('data-total')
    ).toBe('2')
  })

  it('ignores stale page responses so an older request cannot overwrite the current page', async () => {
    let resolveFirstPage:
      | ((response: { conversations: Conversation[]; total: number }) => void)
      | undefined

    fetchMock.kunFetchGet.mockImplementation(
      (_url: string, query?: { page?: number }) => {
        if (query?.page === 1 && !resolveFirstPage) {
          return new Promise((resolve) => {
            resolveFirstPage = resolve
          })
        }

        if (query?.page === 2) {
          return Promise.resolve({
            conversations: [conversation(0, 'page two')],
            total: 61
          })
        }

        return Promise.resolve({
          conversations: [conversation(0, 'fallback')],
          total: 61
        })
      }
    )

    const { container } = await renderList(false, { total: 61 })

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="next-page"]')
        ?.click()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('page two')

    await act(async () => {
      resolveFirstPage?.({
        conversations: [conversation(0, 'stale page one')],
        total: 61
      })
      await Promise.resolve()
    })

    expect(container.textContent).toContain('page two')
    expect(container.textContent).not.toContain('stale page one')
  })

  it('does not let silent polling supersede an explicit page load', async () => {
    let resolveSecondPage:
      | ((response: { conversations: Conversation[]; total: number }) => void)
      | undefined

    fetchMock.kunFetchGet.mockImplementation(
      (_url: string, query?: { page?: number }) => {
        if (query?.page === 1) {
          return Promise.resolve({
            conversations: [conversation(0, 'page one')],
            total: 61
          })
        }

        return new Promise((resolve) => {
          resolveSecondPage = resolve
        })
      }
    )

    const { container } = await renderList(false, { total: 61 })
    await act(async () => {
      await Promise.resolve()
    })

    fetchMock.kunFetchGet.mockClear()

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="next-page"]')
        ?.click()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('正在获取会话列表...')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })

    expect(fetchMock.kunFetchGet).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveSecondPage?.({
        conversations: [conversation(0, 'page two')],
        total: 61
      })
      await Promise.resolve()
    })

    expect(container.textContent).toContain('page two')
    expect(container.textContent).not.toContain('正在获取会话列表...')
  })

  it('disables Next.js prefetch for personalized chat detail links', async () => {
    const { container } = await renderList()

    expect(
      container
        .querySelector('[data-testid="conversation-link"]')
        ?.getAttribute('data-prefetch')
    ).toBe('false')
  })

  it('uses semantic readable colors for conversation cards', async () => {
    const { container } = await renderList()

    const card = container.querySelector('[data-testid="conversation-link"]')
    expect(card?.className).toContain('bg-[var(--kun-chat-list-card-bg)]')
    expect(card?.className).toContain('text-[var(--kun-chat-text-primary)]')
    expect(card?.className).toContain(
      'border-[var(--kun-chat-list-card-border)]'
    )
  })
})
