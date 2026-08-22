import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { UserInfo } from '~/types/api/user'

globalThis.React = React

const routerMock = vi.hoisted(() => ({
  push: vi.fn()
}))

const userStoreState = vi.hoisted(() => ({
  user: {
    uid: 7,
    role: 1
  }
}))

vi.mock('@bprogress/next', () => ({
  useRouter: () => routerMock
}))

vi.mock('~/store/userStore', () => ({
  useUserStore: (selector: (state: typeof userStoreState) => unknown) =>
    selector(userStoreState)
}))

vi.mock('~/hooks/useMounted', () => ({
  useMounted: () => true
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/'
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    className,
    href
  }: {
    children?: React.ReactNode
    className?: string
    href: string
  }) => (
    <a className={className} href={href}>
      {children}
    </a>
  )
}))

vi.mock('next/image', () => ({
  default: () => <span data-testid="brand-image" />
}))

vi.mock('@heroui/navbar', () => ({
  Navbar: ({ children }: { children?: React.ReactNode }) => (
    <nav>{children}</nav>
  ),
  NavbarContent: ({
    children,
    className
  }: {
    children?: React.ReactNode
    className?: string
  }) => (
    <div data-desktop-nav={className?.includes('sm:flex') ? 'true' : undefined}>
      {children}
    </div>
  ),
  NavbarItem: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  NavbarMenu: ({ children }: { children?: React.ReactNode }) => (
    <aside data-mobile-menu>{children}</aside>
  ),
  NavbarMenuItem: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  NavbarMenuToggle: () => <button aria-label="打开导航" />
}))

vi.mock('@heroui/button', () => ({
  Button: ({
    children,
    onPress,
    startContent
  }: {
    children?: React.ReactNode
    onPress?: () => void
    startContent?: React.ReactNode
  }) => (
    <button type="button" onClick={onPress}>
      {startContent}
      {children}
    </button>
  )
}))

vi.mock('lucide-react', () => ({
  BadgeCheck: () => <span data-testid="badge-check" />,
  Pencil: () => <span data-testid="pencil" />,
  ReceiptText: () => <span data-testid="receipt" />,
  Shield: () => <span data-testid="shield" />
}))

vi.mock('~/components/kun/top-bar/Brand', () => ({
  KunTopBarBrand: () => <span data-testid="brand" />
}))

vi.mock('~/components/kun/top-bar/User', () => ({
  KunTopBarUser: () => <span data-testid="top-bar-user" />
}))

const createUser = (role: number): UserInfo => ({
  id: 7,
  requestUserUid: 7,
  name: 'Saya',
  email: 'saya@example.com',
  avatar: '/avatar.webp',
  bio: '',
  role,
  status: 0,
  registerTime: '2026-08-22T00:00:00.000Z',
  moemoepoint: 100,
  follower: 0,
  following: 0,
  isFollow: false,
  _count: {
    patch: 0,
    patch_resource: 0,
    patch_comment: 0,
    patch_favorite: 0,
    patch_rating: 0,
    send_message: 0
  }
})

describe('top bar and self-profile navigation', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const render = async (element: React.ReactNode) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()
    root = createRoot(container!)
    await act(async () => {
      root!.render(element)
    })
    return container!
  }

  const hrefs = (container: Element, selector: string) =>
    [...container.querySelectorAll<HTMLAnchorElement>(selector)].map((link) =>
      link.getAttribute('href')
    )

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    routerMock.push.mockReset()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('removes moemoepoint from regular desktop and mobile navigation', async () => {
    userStoreState.user = { uid: 7, role: 2 }
    const { KunTopBar } = await import('~/components/kun/top-bar/TopBar')
    const container = await render(<KunTopBar />)

    expect(hrefs(container, '[data-desktop-nav="true"] a')).toEqual([
      '/otomegame',
      '/tag',
      '/company',
      '/doc'
    ])
    expect(hrefs(container, '[data-mobile-menu] .kun-mobile-nav-link')).toEqual(
      [
        '/otomegame',
        '/tag',
        '/company',
        '/doc',
        '/comment',
        '/resource',
        'mailto:contact@otoame.com'
      ]
    )
  })

  it('adds admin immediately after help on desktop and mobile', async () => {
    userStoreState.user = { uid: 7, role: 3 }
    const { KunTopBar } = await import('~/components/kun/top-bar/TopBar')
    const container = await render(<KunTopBar />)

    expect(hrefs(container, '[data-desktop-nav="true"] a')).toEqual([
      '/otomegame',
      '/tag',
      '/company',
      '/doc',
      '/admin'
    ])
    expect(hrefs(container, '[data-mobile-menu] .kun-mobile-nav-link')).toEqual(
      [
        '/otomegame',
        '/tag',
        '/company',
        '/doc',
        '/admin',
        '/comment',
        '/resource',
        'mailto:contact@otoame.com'
      ]
    )
  })

  it('places moemoepoint beside edit and creator application on its own row', async () => {
    const { SelfButton } = await import('~/components/user/SelfButton')
    const container = await render(<SelfButton user={createUser(1)} />)
    const buttons = [...container.querySelectorAll('button')]
    const edit = buttons.find((button) => button.textContent === '编辑信息')
    const ledger = buttons.find((button) => button.textContent === '萌萌点明细')
    const apply = buttons.find(
      (button) => button.textContent === '申请成为创作者'
    )

    expect(edit).toBeDefined()
    expect(ledger).toBeDefined()
    expect(apply).toBeDefined()
    expect(edit?.parentElement).toBe(ledger?.parentElement)
    expect(apply?.parentElement).not.toBe(edit?.parentElement)

    await act(async () => {
      ledger?.click()
    })
    expect(routerMock.push).toHaveBeenCalledWith('/moemoepoint')
  })

  it.each([3, 4])(
    'shows the admin button on a separate row for backend role %i',
    async (role) => {
      const { SelfButton } = await import('~/components/user/SelfButton')
      const container = await render(<SelfButton user={createUser(role)} />)
      const buttons = [...container.querySelectorAll('button')]
      const edit = buttons.find((button) => button.textContent === '编辑信息')
      const ledger = buttons.find(
        (button) => button.textContent === '萌萌点明细'
      )
      const admin = buttons.find((button) => button.textContent === '管理后台')

      expect(edit).toBeDefined()
      expect(ledger).toBeDefined()
      expect(admin).toBeDefined()
      expect(container.textContent).not.toContain('申请成为创作者')
      expect(edit?.parentElement).toBe(ledger?.parentElement)
      expect(admin?.parentElement).not.toBe(edit?.parentElement)

      await act(async () => {
        admin?.click()
      })
      expect(routerMock.push).toHaveBeenCalledWith('/admin')
    }
  )
})
