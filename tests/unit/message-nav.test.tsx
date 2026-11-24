import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'

globalThis.React = React

const navigationMock = vi.hoisted(() => ({
  pathname: '/message/notice'
}))

const syncMock = vi.hoisted(() => ({ refreshUnreadSummary: vi.fn() }))
vi.mock('~/utils/messageSync', () => syncMock)

const fetchMock = vi.hoisted(() => ({
  kunFetchGet: vi.fn(),
  kunFetchPut: vi.fn()
}))

vi.mock('next/navigation', () => ({
  usePathname: () => navigationMock.pathname
}))

vi.mock('~/utils/kunFetch', async (original) => ({
  ...(await original<typeof import('~/utils/kunFetch')>()),
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

describe('MessageNav unread badges', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const renderMessageNav = async (
    unread = {
      hasUnreadNotification: true,
      hasUnreadConversation: false
    },
    className?: string
  ) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { useUserStore } = await import('~/store/userStore')
    useUserStore.setState({
      user: { ...useUserStore.getState().user, uid: 7 },
      sessionStatus: 'authenticated',
      sessionContext: 'ctx-a',
      sessionGeneration: 1
    })
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
      root!.render(<MessageNav className={className} />)
    })

    const rerenderAt = async (pathname: string) => {
      navigationMock.pathname = pathname
      await act(async () => {
        root!.render(<MessageNav className={className} />)
      })
    }

    return { container: container!, rerenderAt, useMessageStore, useUserStore }
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
    syncMock.refreshUnreadSummary.mockReset()
  })

  it('opens notifications without confirming unseen content or hiding the unread state', async () => {
    const { useMessageStore } = await renderMessageNav()
    expect(fetchMock.kunFetchPut).not.toHaveBeenCalled()
    expect(useMessageStore.getState().hasUnreadNotification).toBe(true)
  })

  it('uses the shared summary across navigation without reading unseen content', async () => {
    navigationMock.pathname = '/message/chat'
    const { container, rerenderAt, useMessageStore } = await renderMessageNav()
    await rerenderAt('/message/notice')
    expect(fetchMock.kunFetchGet).not.toHaveBeenCalled()
    expect(fetchMock.kunFetchPut).not.toHaveBeenCalled()
    expect(syncMock.refreshUnreadSummary).not.toHaveBeenCalled()
    expect(useMessageStore.getState().hasUnreadNotification).toBe(true)
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      '/message/notice?state=unread'
    )
  })

  it('applies caller classes to the navigation card', async () => {
    const { container } = await renderMessageNav(undefined, 'custom-navigation')
    expect(container.firstElementChild?.className).toContain(
      'custom-navigation'
    )
  })

  it('keeps the notification and conversation indicators independent', async () => {
    const { useMessageStore, container } = await renderMessageNav({
      hasUnreadNotification: false,
      hasUnreadConversation: true
    })
    expect(useMessageStore.getState()).toMatchObject({
      hasUnreadNotification: false,
      hasUnreadConversation: true
    })
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      '/message/notice'
    )
    expect(fetchMock.kunFetchPut).not.toHaveBeenCalled()
  })
})
