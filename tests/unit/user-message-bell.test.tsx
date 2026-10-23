import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import toast from 'react-hot-toast'

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
  moemoepointReserved: 0,
  moemoepointAvailable: 100,
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

const guestUser = {
  ...user,
  uid: 0,
  name: '',
  role: 1
}

const serverUser = {
  ...user,
  uid: 7,
  name: 'Saya',
  role: 2
}

const switchedUser = {
  ...user,
  uid: 9,
  name: 'Ren',
  role: 4
}

const settleEffects = async () => {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

describe('KunTopBarUser message bell', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const renderTopBarUser = async (
    unread = {
      hasUnreadNotification: true,
      hasUnreadConversation: true
    },
    options?: {
      user?: typeof user
      keepFetchMock?: boolean
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
    const initialUser = options?.user ?? user
    useUserStore.setState({ user: initialUser })
    useMessageStore.setState(
      {
        ...useMessageStore.getState(),
        ...unread
      },
      true
    )

    if (!options?.keepFetchMock) {
      fetchMock.kunFetchGet.mockResolvedValue({
        user: initialUser,
        unread
      })
    }

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

    return { container: container!, useMessageStore, useUserStore }
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
    vi.mocked(toast.error).mockClear()
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
      bell!.dispatchEvent(
        new dom!.window.MouseEvent('click', { bubbles: true })
      )
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
      bell!.dispatchEvent(
        new dom!.window.MouseEvent('click', { bubbles: true })
      )
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
      bell!.dispatchEvent(
        new dom!.window.MouseEvent('click', { bubbles: true })
      )
    })

    expect(routerMock.push).toHaveBeenCalledWith('/message/notice')
    expect(fetchMock.kunFetchPut).not.toHaveBeenCalled()
    expect(useMessageStore.getState().hasUnreadNotification).toBe(false)
    expect(useMessageStore.getState().hasUnreadConversation).toBe(true)
  })

  it('keeps the current unread store state when session does not refresh unread status', async () => {
    fetchMock.kunFetchGet.mockResolvedValueOnce({
      user,
      unread: null
    })

    const { useMessageStore } = await renderTopBarUser({
      hasUnreadNotification: true,
      hasUnreadConversation: true
    })

    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith('/user/session')
    expect(useMessageStore.getState()).toMatchObject({
      hasUnreadNotification: true,
      hasUnreadConversation: true
    })
  })

  it('restores the server user when a cookie exists and the local cache is empty', async () => {
    const sessionUnread = {
      hasUnreadNotification: false,
      hasUnreadConversation: true
    }
    fetchMock.kunFetchGet.mockResolvedValue({
      user: serverUser,
      unread: sessionUnread
    })

    const { container, useMessageStore, useUserStore } = await renderTopBarUser(
      {
        hasUnreadNotification: false,
        hasUnreadConversation: false
      },
      { user: guestUser, keepFetchMock: true }
    )
    await settleEffects()

    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith('/user/session')
    expect(fetchMock.kunFetchGet.mock.calls.length).toBe(2)
    expect(useUserStore.getState().user).toMatchObject({
      uid: serverUser.uid,
      name: serverUser.name,
      role: serverUser.role
    })
    expect(useMessageStore.getState()).toMatchObject(sessionUnread)
    expect(
      container.querySelector('[data-testid="user-dropdown"]')
    ).not.toBeNull()
    expect(container.querySelector('a[href="/login"]')).toBeNull()
    expect(fetchMock.kunFetchPost).not.toHaveBeenCalled()
    expect(routerMock.push).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    await settleEffects()
    expect(fetchMock.kunFetchGet.mock.calls.length).toBe(2)
  })

  it('keeps unread state when an empty cache recovers a session without unread', async () => {
    fetchMock.kunFetchGet.mockResolvedValue({
      user: serverUser,
      unread: null
    })

    const { useMessageStore, useUserStore } = await renderTopBarUser(
      {
        hasUnreadNotification: true,
        hasUnreadConversation: true
      },
      { user: guestUser, keepFetchMock: true }
    )
    await settleEffects()

    expect(useUserStore.getState().user.uid).toBe(serverUser.uid)
    expect(useMessageStore.getState()).toMatchObject({
      hasUnreadNotification: true,
      hasUnreadConversation: true
    })
  })

  it('stays on the public page when session reports no signed-in user', async () => {
    fetchMock.kunFetchGet.mockResolvedValue('用户登陆失效')

    const { container, useMessageStore, useUserStore } = await renderTopBarUser(
      {
        hasUnreadNotification: true,
        hasUnreadConversation: false
      },
      { user: guestUser, keepFetchMock: true }
    )
    await settleEffects()

    expect(fetchMock.kunFetchGet).toHaveBeenCalledTimes(1)
    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith('/user/session')
    expect(fetchMock.kunFetchPost).not.toHaveBeenCalled()
    expect(routerMock.push).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(useUserStore.getState().user).toMatchObject({
      uid: 0,
      name: '',
      role: 1
    })
    expect(useMessageStore.getState()).toMatchObject({
      hasUnreadNotification: true,
      hasUnreadConversation: false
    })
    expect(container.querySelector('a[href="/login"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="user-dropdown"]')).toBeNull()
    await settleEffects()
    expect(fetchMock.kunFetchGet).toHaveBeenCalledTimes(1)
  })

  it('does not log out or retry when session recovery fails on the network', async () => {
    fetchMock.kunFetchGet.mockRejectedValue(new Error('offline'))

    const { container, useUserStore } = await renderTopBarUser(
      {
        hasUnreadNotification: true,
        hasUnreadConversation: true
      },
      { user: guestUser, keepFetchMock: true }
    )
    await settleEffects()

    expect(fetchMock.kunFetchGet).toHaveBeenCalledTimes(1)
    expect(fetchMock.kunFetchPost).not.toHaveBeenCalled()
    expect(routerMock.push).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(useUserStore.getState().user.uid).toBe(0)
    expect(container.querySelector('a[href="/login"]')).not.toBeNull()
    await settleEffects()
    expect(fetchMock.kunFetchGet).toHaveBeenCalledTimes(1)
  })

  it('still logs out once when a known cached user session has expired', async () => {
    fetchMock.kunFetchGet.mockResolvedValue('用户登陆失效')
    fetchMock.kunFetchPost.mockResolvedValue({})

    const { useMessageStore, useUserStore } = await renderTopBarUser(
      {
        hasUnreadNotification: true,
        hasUnreadConversation: true
      },
      { keepFetchMock: true }
    )
    await settleEffects()

    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('用户登陆失效')
    expect(fetchMock.kunFetchPost).toHaveBeenCalledTimes(1)
    expect(fetchMock.kunFetchPost).toHaveBeenCalledWith('/user/status/logout')
    expect(routerMock.push).toHaveBeenCalledTimes(1)
    expect(routerMock.push).toHaveBeenCalledWith('/login')
    expect(useUserStore.getState().user.uid).toBe(0)
    expect(useMessageStore.getState()).toMatchObject({
      hasUnreadNotification: false,
      hasUnreadConversation: false
    })
    expect(fetchMock.kunFetchGet.mock.calls.length).toBe(2)
    await settleEffects()
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(fetchMock.kunFetchGet.mock.calls.length).toBe(2)
  })

  it('ignores a late empty-cache response after an account switch', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined
    let calls = 0
    fetchMock.kunFetchGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          calls += 1
          if (calls === 1) {
            resolveFirst = resolve
          }
        })
    )

    const { useMessageStore, useUserStore } = await renderTopBarUser(
      {
        hasUnreadNotification: false,
        hasUnreadConversation: false
      },
      { user: guestUser, keepFetchMock: true }
    )
    expect(calls).toBe(1)

    await act(async () => {
      useUserStore.getState().setUser(switchedUser)
    })
    expect(calls).toBe(2)

    resolveFirst?.({
      user: serverUser,
      unread: {
        hasUnreadNotification: true,
        hasUnreadConversation: true
      }
    })
    await settleEffects()

    expect(useUserStore.getState().user).toMatchObject({
      uid: switchedUser.uid,
      name: switchedUser.name,
      role: switchedUser.role
    })
    expect(useMessageStore.getState()).toMatchObject({
      hasUnreadNotification: false,
      hasUnreadConversation: false
    })
    expect(fetchMock.kunFetchPost).not.toHaveBeenCalled()
    expect(routerMock.push).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(calls).toBe(2)
  })

  it('ignores a late expiry response after the cached user has changed', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined
    let calls = 0
    fetchMock.kunFetchGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          calls += 1
          if (calls === 1) {
            resolveFirst = resolve
          }
        })
    )

    const { useUserStore } = await renderTopBarUser(
      {
        hasUnreadNotification: true,
        hasUnreadConversation: true
      },
      { keepFetchMock: true }
    )
    expect(calls).toBe(1)

    await act(async () => {
      useUserStore.getState().setUser(switchedUser)
    })
    resolveFirst?.('用户登陆失效')
    await settleEffects()

    expect(useUserStore.getState().user).toMatchObject({
      uid: switchedUser.uid,
      name: switchedUser.name,
      role: switchedUser.role
    })
    expect(toast.error).not.toHaveBeenCalled()
    expect(fetchMock.kunFetchPost).not.toHaveBeenCalled()
    expect(routerMock.push).not.toHaveBeenCalled()
  })

  it('ignores a late session user after logout', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined
    fetchMock.kunFetchGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          if (!resolveFirst) {
            resolveFirst = resolve
          }
        })
    )

    const { useMessageStore, useUserStore } = await renderTopBarUser(
      {
        hasUnreadNotification: true,
        hasUnreadConversation: true
      },
      { keepFetchMock: true }
    )

    await act(async () => {
      useUserStore.getState().logout()
    })
    resolveFirst?.({
      user: serverUser,
      unread: {
        hasUnreadNotification: false,
        hasUnreadConversation: false
      }
    })
    await settleEffects()

    expect(useUserStore.getState().user).toMatchObject({ uid: 0, name: '' })
    expect(useMessageStore.getState()).toMatchObject({
      hasUnreadNotification: true,
      hasUnreadConversation: true
    })
    expect(toast.error).not.toHaveBeenCalled()
    expect(routerMock.push).not.toHaveBeenCalled()
  })
})
