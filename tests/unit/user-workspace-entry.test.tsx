import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserInfo } from '~/types/api/user'

globalThis.React = React

const routerMock = vi.hoisted(() => ({
  push: vi.fn()
}))

vi.mock('@bprogress/next', () => ({
  useRouter: () => routerMock
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/user/4/comment',
  useRouter: () => routerMock
}))

vi.mock('@heroui/button', () => ({
  Button: ({
    children,
    onPress,
    fullWidth,
    color
  }: {
    children?: React.ReactNode
    onPress?: () => void
    fullWidth?: boolean
    color?: string
  }) => (
    <button
      type="button"
      data-full-width={fullWidth ? 'true' : 'false'}
      data-color={color}
      onClick={onPress}
    >
      {children}
    </button>
  )
}))

vi.mock('@heroui/card', () => ({
  Card: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  CardBody: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
}))

vi.mock('@heroui/tabs', () => ({
  Tabs: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Tab: ({ title, href }: { title?: React.ReactNode; href?: string }) => (
    <a href={href}>{title}</a>
  )
}))

import { UserActivity } from '~/components/user/Activity'
import { SelfButton } from '~/components/user/SelfButton'

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

describe('user workspace entry', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  const render = async (node: React.ReactNode) => {
    if (root) {
      act(() => {
        root?.unmount()
      })
      root = undefined
    }
    dom?.window.close()
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/user/4/comment'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const { createRoot } = await import('react-dom/client')
    const container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(node)
    })
    return container
  }

  it('removes the workspace tab from public activity', async () => {
    const container = await render(<UserActivity id={4} />)
    const hrefs = [...container.querySelectorAll('a')].map((link) =>
      link.getAttribute('href')
    )
    expect(hrefs).toEqual([
      '/user/4/comment',
      '/user/4/favorite',
      '/user/4/resource',
      '/user/4/submission',
      '/user/4/shoutbox'
    ])
    expect(container.textContent).not.toContain('工作台')
    expect(hrefs.join(' ')).not.toContain('/workspace')
  })

  it('adds a full-width workspace button after the admin button', async () => {
    const ordinary = await render(<SelfButton user={createUser(1)} />)
    expect(ordinary.textContent).not.toContain('管理后台')
    const workspace = [...ordinary.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('用户工作台')
    ) as HTMLButtonElement
    const edit = [...ordinary.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('编辑信息')
    ) as HTMLButtonElement
    expect(workspace).toBeTruthy()
    expect(workspace.getAttribute('data-full-width')).toBe('true')
    expect(workspace.getAttribute('data-color')).toBe('primary')
    expect(workspace.parentElement).not.toBe(edit.parentElement)
    await act(async () => {
      workspace.click()
    })
    expect(routerMock.push).toHaveBeenCalledWith('/workspace')

    const adminUser = await render(<SelfButton user={createUser(3)} />)
    const buttons = [...adminUser.querySelectorAll('button')]
    const admin = buttons.find((item) => item.textContent?.includes('管理后台'))
    const workspaceAdmin = buttons.find((item) =>
      item.textContent?.includes('用户工作台')
    )
    const editAdmin = buttons.find((item) =>
      item.textContent?.includes('编辑信息')
    )
    expect(admin).toBeTruthy()
    expect(buttons.indexOf(workspaceAdmin!)).toBeGreaterThan(
      buttons.indexOf(admin!)
    )
    expect(workspaceAdmin?.parentElement).toBe(admin?.parentElement)
    expect(workspaceAdmin?.parentElement).not.toBe(editAdmin?.parentElement)
    expect(adminUser.textContent).not.toContain('申请成为创作者')
    await act(async () => {
      admin?.click()
    })
    expect(routerMock.push).toHaveBeenCalledWith('/dashboard')
  })
})
