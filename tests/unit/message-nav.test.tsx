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

  it('uses the shared summary on every navigation without another GET', async () => {
    navigationMock.pathname = '/message/chat'
    const { rerenderAt } = await renderMessageNav()
    await rerenderAt('/message/notice')
    expect(fetchMock.kunFetchGet).not.toHaveBeenCalled()
    expect(fetchMock.kunFetchPut).toHaveBeenCalledWith(
      '/message/read',
      undefined,
      expect.objectContaining({
        timeout: 15_000,
        preserveErrorStatus: true,
        signal: expect.anything()
      })
    )
  })
  it('cancels the notification confirmation when leaving its identity', async () => {
    const pending = createDeferred<unknown>()
    fetchMock.kunFetchPut.mockReturnValueOnce(pending.promise)
    const { rerenderAt } = await renderMessageNav()
    const signal = fetchMock.kunFetchPut.mock.calls[0][2].signal as AbortSignal
    await rerenderAt('/message/chat')
    expect(signal.aborted).toBe(true)
    await act(async () => {
      pending.resolve({})
    })
  })
  it('applies caller classes to the navigation card', async () => {
    const { container } = await renderMessageNav(undefined, 'custom-navigation')
    expect(container.firstElementChild?.className).toContain(
      'custom-navigation'
    )
  })
  it('keeps notification and conversation states independent after a successful read', async () => {
    fetchMock.kunFetchPut.mockResolvedValueOnce({
      hasUnreadNotification: false,
      hasUnreadConversation: true
    })
    const { useMessageStore } = await renderMessageNav()
    expect(useMessageStore.getState()).toMatchObject({
      hasUnreadNotification: false,
      hasUnreadConversation: true
    })
  })
  it.each(['network', 'business'])(
    'restores notification state and requests shared recovery after %s failure',
    async (failure) => {
      if (failure === 'network')
        fetchMock.kunFetchPut.mockRejectedValueOnce(new Error('offline'))
      else fetchMock.kunFetchPut.mockResolvedValueOnce('safe business failure')
      const { useMessageStore } = await renderMessageNav({
        hasUnreadNotification: true,
        hasUnreadConversation: true
      })
      expect(useMessageStore.getState()).toMatchObject({
        hasUnreadNotification: true,
        hasUnreadConversation: true
      })
      expect(syncMock.refreshUnreadSummary).toHaveBeenCalledWith('manual')
      expect(fetchMock.kunFetchGet).not.toHaveBeenCalled()
    }
  )
  it('ignores a late notification result after a same-account session change', async () => {
    const pending = createDeferred<unknown>()
    fetchMock.kunFetchPut.mockReturnValueOnce(pending.promise)
    const { useUserStore, useMessageStore } = await renderMessageNav()
    await act(async () => {
      useUserStore.setState({ sessionContext: 'ctx-b', sessionGeneration: 2 })
      useMessageStore.getState().setUnreadMessageStatus({
        hasUnreadNotification: true,
        hasUnreadConversation: true
      })
    })
    await act(async () => {
      pending.resolve({
        hasUnreadNotification: false,
        hasUnreadConversation: false
      })
    })
    expect(useMessageStore.getState().hasUnreadConversation).toBe(true)
  })
})
