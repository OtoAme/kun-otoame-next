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
  )
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
  KunPagination: () => <div data-testid="pagination" />
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

describe('MessageContainer initial notification view', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

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
        <MessageContainer initialMessages={[unreadMessage]} total={1} />
      )
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchGet).not.toHaveBeenCalled()
    expect(container!.textContent).toContain('新消息')
    expect(container!.textContent).not.toContain('已阅读')
  })
})
