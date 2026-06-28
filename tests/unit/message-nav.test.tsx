import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'

globalThis.React = React

const navigationMock = vi.hoisted(() => ({
  pathname: '/message/notice'
}))

const fetchMock = vi.hoisted(() => ({
  kunFetchGet: vi.fn(),
  kunFetchPut: vi.fn()
}))

vi.mock('next/navigation', () => ({
  usePathname: () => navigationMock.pathname
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
  }) => <div className={className}>{children}</div>
}))

vi.mock('@heroui/react', () => ({
  Button: ({
    children,
    as: Component = 'button',
    href,
    className,
    startContent
  }: {
    children?: React.ReactNode
    as?: React.ElementType
    href?: string
    className?: string
    startContent?: React.ReactNode
  }) => (
    <Component href={href} className={className}>
      {startContent}
      {children}
    </Component>
  )
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn()
  }
}))

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })

  return { promise, resolve }
}

describe('MessageNav unread badges', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const renderMessageNav = async (
    unread = {
      hasUnreadNotification: true,
      hasUnreadConversation: false
    }
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
        ...unread
      },
      true
    )

    const { MessageNav } = await import('~/components/message/MessageNav')
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(<MessageNav />)
    })

    const rerenderAt = async (pathname: string) => {
      navigationMock.pathname = pathname
      await act(async () => {
        root!.render(<MessageNav />)
      })
    }

    return { container: container!, rerenderAt, useMessageStore }
  }

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    navigationMock.pathname = '/message/notice'
    vi.unstubAllGlobals()
    vi.resetModules()
    fetchMock.kunFetchGet.mockReset()
    fetchMock.kunFetchPut.mockReset()
  })

  it('marks notifications as read without issuing a stale unread request on notification pages', async () => {
    fetchMock.kunFetchGet.mockResolvedValue({
      hasUnreadMessages: false,
      hasUnreadChat: false
    })
    fetchMock.kunFetchPut.mockResolvedValue({
      hasUnreadNotification: false,
      hasUnreadConversation: false
    })

    const { container, rerenderAt, useMessageStore } = await renderMessageNav()

    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchGet).not.toHaveBeenCalled()
    expect(fetchMock.kunFetchPut).toHaveBeenCalledWith('/message/read')
    expect(useMessageStore.getState().hasUnreadNotification).toBe(false)

    await rerenderAt('/message/chat')

    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith('/message/unread')
    expect(container.querySelector('.bg-danger')).toBeNull()
  })

  it('syncs unread conversations from the global unread status after notifications are read', async () => {
    fetchMock.kunFetchGet.mockResolvedValue({
      hasUnreadMessages: false,
      hasUnreadChat: true
    })
    fetchMock.kunFetchPut.mockResolvedValue({
      hasUnreadNotification: false,
      hasUnreadConversation: true
    })

    const { container, rerenderAt, useMessageStore } = await renderMessageNav()

    await act(async () => {
      await Promise.resolve()
    })

    expect(useMessageStore.getState().hasUnreadNotification).toBe(false)
    expect(useMessageStore.getState().hasUnreadConversation).toBe(true)

    await rerenderAt('/message/chat')

    await act(async () => {
      await Promise.resolve()
    })

    expect(useMessageStore.getState().hasUnreadNotification).toBe(false)
    expect(useMessageStore.getState().hasUnreadConversation).toBe(true)
    expect(container.querySelector('.bg-danger')).toBeNull()

    await rerenderAt('/message/notice')

    expect(container.querySelector('.bg-danger')).not.toBeNull()
  })

  it('ignores an unread request that resolves after navigating into notification messages', async () => {
    navigationMock.pathname = '/message/chat'
    const unreadRequest = createDeferred<{
      hasUnreadMessages: boolean
      hasUnreadChat: boolean
    }>()
    fetchMock.kunFetchGet.mockReturnValueOnce(unreadRequest.promise)
    fetchMock.kunFetchGet.mockResolvedValue({
      hasUnreadMessages: false,
      hasUnreadChat: false
    })
    fetchMock.kunFetchPut.mockResolvedValue({
      hasUnreadNotification: false,
      hasUnreadConversation: false
    })

    const { container, rerenderAt, useMessageStore } = await renderMessageNav()

    await rerenderAt('/message/notice')

    await act(async () => {
      await Promise.resolve()
    })

    expect(useMessageStore.getState().hasUnreadNotification).toBe(false)

    await act(async () => {
      unreadRequest.resolve({
        hasUnreadMessages: true,
        hasUnreadChat: false
      })
      await unreadRequest.promise
    })

    await rerenderAt('/message/chat')

    await act(async () => {
      await Promise.resolve()
    })

    expect(container.querySelector('.bg-danger')).toBeNull()
  })
})
