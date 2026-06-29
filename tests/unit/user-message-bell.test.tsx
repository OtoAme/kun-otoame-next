import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'

globalThis.React = React

const routerMock = vi.hoisted(() => ({
  push: vi.fn()
}))

const fetchMock = vi.hoisted(() => ({
  kunFetchGet: vi.fn(),
  kunFetchPost: vi.fn(),
  kunFetchPut: vi.fn()
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: fetchMock.kunFetchGet,
  kunFetchPost: fetchMock.kunFetchPost,
  kunFetchPut: fetchMock.kunFetchPut
}))

vi.mock('@bprogress/next', () => ({
  useRouter: () => routerMock
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

vi.mock('@heroui/navbar', () => ({
  NavbarContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  NavbarItem: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
}))

vi.mock('@heroui/button', () => ({
  Button: ({
    children,
    onPress,
    className,
    'aria-label': ariaLabel
  }: {
    children?: React.ReactNode
    onPress?: () => void
    className?: string
    'aria-label'?: string
  }) => (
    <button aria-label={ariaLabel} className={className} onClick={onPress}>
      {children}
    </button>
  )
}))

vi.mock('@heroui/skeleton', () => ({
  Skeleton: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
}))

vi.mock('@heroui/tooltip', () => ({
  Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>
}))

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  motion: {
    div: ({
      children,
      className
    }: {
      children?: React.ReactNode
      className?: string
    }) => <div className={className}>{children}</div>
  }
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

vi.mock('~/components/kun/top-bar/ThemeSwitcher', () => ({
  ThemeSwitcher: () => <div data-testid="theme-switcher" />
}))

vi.mock('~/components/kun/top-bar/UserDropdown', () => ({
  UserDropdown: () => <div data-testid="user-dropdown" />
}))

vi.mock('~/components/kun/top-bar/Search', () => ({
  KunSearch: () => <div data-testid="search" />
}))

vi.mock('~/components/home/carousel/RandomGalgameButton', () => ({
  RandomGalgameButton: () => <button aria-label="随机一部游戏" />
}))

const user = {
  uid: 7,
  name: 'Saya',
  avatar: '/avatar.webp',
  bio: '',
  moemoepoint: 100,
  role: 3,
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

describe('KunTopBarUser message bell', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const renderTopBarUser = async (
    unread = {
      hasUnreadNotification: true,
      hasUnreadConversation: true
    }
  ) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('localStorage', dom.window.localStorage)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { useUserStore } = await import('~/store/userStore')
    const { useMessageStore } = await import('~/store/messageStore')
    useUserStore.setState({ user })
    useMessageStore.setState(
      {
        ...useMessageStore.getState(),
        ...unread
      },
      true
    )

    fetchMock.kunFetchGet.mockResolvedValue({
      user,
      unread
    })

    const { KunTopBarUser } = await import('~/components/kun/top-bar/User')
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(<KunTopBarUser />)
    })

    await act(async () => {
      await Promise.resolve()
    })

    return { container: container!, useMessageStore }
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
    routerMock.push.mockReset()
    fetchMock.kunFetchGet.mockReset()
    fetchMock.kunFetchPost.mockReset()
    fetchMock.kunFetchPut.mockReset()
  })

  it('opens the notification center without marking notifications read first', async () => {
    const { container, useMessageStore } = await renderTopBarUser()

    fetchMock.kunFetchPut.mockResolvedValue({
      hasUnreadNotification: false,
      hasUnreadConversation: true
    })

    const bell = container.querySelector<HTMLButtonElement>(
      'button[aria-label="我的消息"]'
    )
    expect(bell).not.toBeNull()

    await act(async () => {
      bell!.dispatchEvent(new dom!.window.MouseEvent('click', { bubbles: true }))
    })

    expect(routerMock.push).toHaveBeenCalledWith('/message/notice')
    expect(fetchMock.kunFetchPut).not.toHaveBeenCalled()
    expect(useMessageStore.getState().hasUnreadNotification).toBe(true)
    expect(useMessageStore.getState().hasUnreadConversation).toBe(true)
  })

  it('does not mark messages read when there is no unread state', async () => {
    const { container } = await renderTopBarUser({
      hasUnreadNotification: false,
      hasUnreadConversation: false
    })

    const bell = container.querySelector<HTMLButtonElement>(
      'button[aria-label="我的消息"]'
    )
    expect(bell).not.toBeNull()

    await act(async () => {
      bell!.dispatchEvent(new dom!.window.MouseEvent('click', { bubbles: true }))
    })

    expect(routerMock.push).toHaveBeenCalledWith('/message/notice')
    expect(fetchMock.kunFetchPut).not.toHaveBeenCalled()
  })

  it('does not mark notification messages read when only conversations are unread', async () => {
    const { container, useMessageStore } = await renderTopBarUser({
      hasUnreadNotification: false,
      hasUnreadConversation: true
    })

    const bell = container.querySelector<HTMLButtonElement>(
      'button[aria-label="我的消息"]'
    )
    expect(bell).not.toBeNull()

    await act(async () => {
      bell!.dispatchEvent(new dom!.window.MouseEvent('click', { bubbles: true }))
    })

    expect(routerMock.push).toHaveBeenCalledWith('/message/notice')
    expect(fetchMock.kunFetchPut).not.toHaveBeenCalled()
    expect(useMessageStore.getState().hasUnreadNotification).toBe(false)
    expect(useMessageStore.getState().hasUnreadConversation).toBe(true)
  })
})
