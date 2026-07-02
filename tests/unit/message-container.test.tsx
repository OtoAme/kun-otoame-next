import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { Message } from '~/types/api/message'

globalThis.React = React

const fetchMock = vi.hoisted(() => ({
  kunFetchDelete: vi.fn(),
  kunFetchGet: vi.fn()
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchDelete: fetchMock.kunFetchDelete,
  kunFetchGet: fetchMock.kunFetchGet
}))

vi.mock('~/hooks/useMounted', () => ({
  useMounted: () => true
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
    as: Component = 'div',
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
  ),
  CardBody: ({
    children,
    className
  }: {
    children?: React.ReactNode
    className?: string
  }) => <div className={className}>{children}</div>
}))

vi.mock('@heroui/avatar', () => ({
  Avatar: ({ name }: { name?: string }) => <span>{name}</span>
}))

vi.mock('@heroui/chip', () => ({
  Chip: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  )
}))

vi.mock('@heroui/react', () => ({
  Button: ({
    children,
    onPress,
    isDisabled,
    isLoading
  }: {
    children?: React.ReactNode
    onPress?: () => void
    isDisabled?: boolean
    isLoading?: boolean
  }) => (
    <button disabled={isDisabled || isLoading} onClick={onPress}>
      {children}
    </button>
  ),
  Modal: ({
    children,
    isOpen
  }: {
    children?: React.ReactNode
    isOpen?: boolean
  }) => (isOpen ? <div role="dialog">{children}</div> : null),
  ModalContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalHeader: ({ children }: { children?: React.ReactNode }) => (
    <h2>{children}</h2>
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
      onClose: () => setIsOpen(false),
      onOpenChange: setIsOpen
    }
  }
}))

vi.mock('~/components/kun/floating-card/KunAvatar', () => ({
  KunAvatar: () => <span>avatar</span>
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
    onPageChange,
    isLoading
  }: {
    total: number
    page: number
    onPageChange: (page: number) => void
    isLoading?: boolean
  }) => (
    <div
      data-testid="pagination"
      data-total={total}
      data-loading={String(Boolean(isLoading))}
    >
      <button data-testid="next-page" onClick={() => onPageChange(page + 1)}>
        next
      </button>
    </div>
  )
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

const unreadMessage: Message = {
  id: 1,
  type: 'system',
  content: '新的系统消息',
  status: 0,
  link: '/message-target',
  created: '2026-06-30T00:00:00.000Z',
  sender: null
}

const messageWithContent = (id: number, content: string): Message => ({
  ...unreadMessage,
  id,
  content,
  status: 1
})

describe('MessageContainer initial notification view', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const renderContainer = async (
    props: {
      initialMessages?: Message[]
      total?: number
    } = {}
  ) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/message/notice'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { MessageContainer } = await import('~/components/message/Container')
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(
        <MessageContainer
          initialMessages={props.initialMessages ?? [unreadMessage]}
          total={props.total ?? 1}
        />
      )
    })

    return { container: container! }
  }

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
    vi.resetModules()
    fetchMock.kunFetchDelete.mockReset()
    fetchMock.kunFetchGet.mockReset()
  })

  it('does not refetch the first notification page during hydration', async () => {
    fetchMock.kunFetchGet.mockResolvedValue({
      messages: [{ ...unreadMessage, status: 1 }],
      total: 1
    })

    const { container } = await renderContainer()

    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchGet).not.toHaveBeenCalled()
    expect(container!.textContent).toContain('新消息')
    expect(container!.textContent).not.toContain('已阅读')
  })

  it('ignores stale page responses so an older notification request cannot overwrite the current page', async () => {
    let resolvePageTwo:
      | ((response: { messages: Message[]; total: number }) => void)
      | undefined

    fetchMock.kunFetchGet.mockImplementation(
      (_url: string, query?: { page?: number }) => {
        if (query?.page === 2) {
          return new Promise((resolve) => {
            resolvePageTwo = resolve
          })
        }

        if (query?.page === 3) {
          return Promise.resolve({
            messages: [messageWithContent(3, 'page three notification')],
            total: 91
          })
        }

        return Promise.resolve({
          messages: [messageWithContent(1, 'fallback notification')],
          total: 91
        })
      }
    )

    const { container } = await renderContainer({
      initialMessages: [messageWithContent(1, 'initial notification')],
      total: 91
    })

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="next-page"]')
        ?.click()
      await Promise.resolve()
    })

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="next-page"]')
        ?.click()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('page three notification')

    await act(async () => {
      resolvePageTwo?.({
        messages: [messageWithContent(2, 'stale page two notification')],
        total: 91
      })
      await Promise.resolve()
    })

    expect(container.textContent).toContain('page three notification')
    expect(container.textContent).not.toContain('stale page two notification')
  })

  it('keeps the current notification page when a page fetch is rate limited', async () => {
    const toast = (await import('react-hot-toast')).default
    vi.mocked(toast.error).mockClear()
    fetchMock.kunFetchGet.mockResolvedValueOnce(
      '通知读取过于频繁, 请 30 秒后重试'
    )

    const { container } = await renderContainer({
      initialMessages: [messageWithContent(1, 'initial notification')],
      total: 91
    })

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="next-page"]')
        ?.click()
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith('/message/all', {
      page: 2,
      limit: 30
    })
    expect(toast.error).toHaveBeenCalledWith(
      '通知读取过于频繁, 请 30 秒后重试'
    )
    expect(container.textContent).toContain('initial notification')
  })

  it('keeps the list and dialog open when clearing read notifications is rate limited', async () => {
    const toast = (await import('react-hot-toast')).default
    vi.mocked(toast.error).mockClear()
    fetchMock.kunFetchDelete.mockResolvedValueOnce(
      '通知操作过于频繁, 请 30 秒后重试'
    )

    const { container } = await renderContainer({
      initialMessages: [messageWithContent(1, 'read notification')],
      total: 1
    })

    const clearButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button')
    ).find((button) => button.textContent === '清理已读信息')

    await act(async () => {
      clearButton?.click()
      await Promise.resolve()
    })

    const confirmButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button')
    ).find((button) => button.textContent === '确认清理')

    await act(async () => {
      confirmButton?.click()
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchDelete).toHaveBeenCalledWith('/message/read', {
      type: ''
    })
    expect(toast.error).toHaveBeenCalledWith(
      '通知操作过于频繁, 请 30 秒后重试'
    )
    expect(fetchMock.kunFetchGet).not.toHaveBeenCalled()
    expect(container.textContent).toContain('确认清理已读信息')
    expect(container.textContent).toContain('read notification')
  })

  it('asks for confirmation before clearing read notifications', async () => {
    fetchMock.kunFetchDelete.mockResolvedValue({})
    fetchMock.kunFetchGet.mockResolvedValue({
      messages: [],
      total: 0
    })

    const { container } = await renderContainer({
      initialMessages: [messageWithContent(1, 'read notification')],
      total: 1
    })

    const clearButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button')
    ).find((button) => button.textContent === '清理已读信息')
    expect(clearButton).not.toBeNull()

    await act(async () => {
      clearButton?.click()
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchDelete).not.toHaveBeenCalled()
    expect(container.textContent).toContain('确认清理已读信息')

    const confirmButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button')
    ).find((button) => button.textContent === '确认清理')
    expect(confirmButton).not.toBeNull()

    await act(async () => {
      confirmButton?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchDelete).toHaveBeenCalledWith('/message/read', {
      type: ''
    })
  })
})
