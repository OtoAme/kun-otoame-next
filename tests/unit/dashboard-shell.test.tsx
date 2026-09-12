import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxCounts } from '~/types/api/inbox'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  logout: vi.fn(),
  resetSettings: vi.fn(),
  resetUnread: vi.fn(),
  toastError: vi.fn(),
  params: '',
  pathname: '/dashboard'
}))
vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: mocks.get,
  kunFetchPost: mocks.post
}))
vi.mock('~/store/userStore', () => ({
  useUserStore: { getState: () => ({ logout: mocks.logout }) }
}))
vi.mock('~/store/settingStore', () => ({
  useSettingStore: { getState: () => ({ resetData: mocks.resetSettings }) }
}))
vi.mock('~/store/messageStore', () => ({
  useMessageStore: {
    getState: () => ({ resetUnreadMessageStatus: mocks.resetUnread })
  }
}))
vi.mock('react-hot-toast', () => ({ default: { error: mocks.toastError } }))
vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(mocks.params)
}))
vi.mock('next/link', () => ({
  default: (props: React.ComponentProps<'a'>) => <a {...props} />
}))
vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light', setTheme: vi.fn() })
}))
// The shell-level banner has its own behavior tests; stub it out so its fetch
// and timers never interfere with the shell's counts/polling assertions.
vi.mock('~/components/dashboard/shoutbox/DashboardShoutboxBanner', () => ({
  DashboardShoutboxBanner: () => null
}))
vi.mock('~/components/dashboard/ui/sidebar', () => {
  const Box = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
  const MenuButton = ({
    asChild,
    children,
    isActive: _active,
    ...props
  }: React.ComponentProps<'button'> & {
    asChild?: boolean
    isActive?: boolean
  }) =>
    asChild ? (
      React.cloneElement(
        children as React.ReactElement<Record<string, unknown>>,
        { 'data-active': String(Boolean(_active)) }
      )
    ) : (
      <button {...props}>{children}</button>
    )
  return {
    Sidebar: Box,
    SidebarContent: Box,
    SidebarFooter: Box,
    SidebarGroup: Box,
    SidebarGroupContent: Box,
    SidebarGroupLabel: Box,
    SidebarHeader: Box,
    SidebarMenu: Box,
    SidebarMenuBadge: Box,
    SidebarMenuButton: MenuButton,
    SidebarMenuItem: Box,
    SidebarInset: Box,
    SidebarProvider: Box,
    SidebarTrigger: () => <button aria-label="打开侧栏" />,
    useSidebar: () => ({ setOpenMobile: vi.fn() })
  }
})
vi.mock('~/components/dashboard/ui/dropdown-menu', () => {
  const Box = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
  return {
    DropdownMenu: Box,
    DropdownMenuContent: Box,
    DropdownMenuLabel: Box,
    DropdownMenuSeparator: Box,
    DropdownMenuTrigger: Box,
    DropdownMenuItem: ({
      children,
      asChild,
      onSelect,
      disabled
    }: {
      children: React.ReactNode
      asChild?: boolean
      onSelect?: () => void
      disabled?: boolean
    }) =>
      asChild ? (
        <>{children}</>
      ) : (
        <button disabled={disabled} onClick={onSelect}>
          {children}
        </button>
      )
  }
})

import {
  DashboardShell,
  useDashboard
} from '~/components/dashboard/DashboardShell'

const counts: InboxCounts = {
  pending: { submission: 5, 'resource-apply': 2, feedback: 3, report: 1 },
  todayProcessed: 4
}
let context: ReturnType<typeof useDashboard>
function Probe() {
  context = useDashboard()
  return <output>{context.counts?.todayProcessed ?? 'loading'}</output>
}

describe('dashboard shell', () => {
  let dom: JSDOM
  let root: Root
  let container: HTMLDivElement
  let poll: () => void

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.params = ''
    mocks.pathname = '/dashboard'
    mocks.get.mockResolvedValue(counts)
    mocks.post.mockResolvedValue({ status: 0 })
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/dashboard'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.spyOn(dom.window, 'setInterval').mockImplementation((callback) => {
      poll = callback as () => void
      return 7
    })
    container = dom.window.document.getElementById('root') as HTMLDivElement
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  const render = async (role = 3) => {
    await act(async () =>
      root.render(
        <DashboardShell currentUser={{ id: 9, name: '审核员', role }}>
          <Probe />
        </DashboardShell>
      )
    )
  }

  it('keeps old processing pages reachable for admins with role hints', async () => {
    await render()
    const link = container.querySelector('a[href="/admin/feedback"]')
    expect(link).not.toBeNull()
    expect(link?.textContent).toContain('超级管理员')
    expect(container.querySelector('a[href="/admin/rating"]')).not.toBeNull()
    expect(container.querySelector('a[href="/admin"]')).toBeNull()
  })

  it('keeps the active source link pointed at that source', async () => {
    mocks.pathname = '/dashboard/inbox'
    mocks.params = 'kinds=submission'
    await render()
    expect(
      container.querySelector('a[href="/dashboard/inbox?kinds=submission"]')
    ).not.toBeNull()
  })

  it.each([
    ['/dashboard/user', '用户管理'],
    ['/dashboard/user/7/moemoepoint', '用户萌萌点明细'],
    ['/dashboard/user/00000007/moemoepoint', '用户萌萌点明细']
  ])(
    'labels the migrated page %s and retains the old user entry',
    async (pathname, title) => {
      mocks.pathname = pathname
      mocks.params = 'kinds=submission'
      await render(4)
      expect(container.querySelector('h1')?.textContent).toBe(title)
      expect(
        container
          .querySelector('a[href="/dashboard/user"]')
          ?.getAttribute('data-active')
      ).toBe('true')
      expect(container.querySelector('a[href="/admin/user"]')).not.toBeNull()
      expect(
        container
          .querySelector('a[href="/dashboard/inbox?kinds=submission"]')
          ?.getAttribute('data-active')
      ).toBe('false')
    }
  )

  it('states that even user-list access requires super administrator permission', async () => {
    await render(3)
    expect(
      container.querySelector('a[href="/dashboard/user"]')?.textContent
    ).toContain('仅超级管理员')
  })

  it.each([
    ['kinds=submission,resource-apply,feedback,report', 'true'],
    ['kinds=submission,report', 'false']
  ])('marks the all-sources entry correctly for %s', async (params, active) => {
    mocks.pathname = '/dashboard/inbox'
    mocks.params = params
    await render()
    const all = [...container.querySelectorAll('a')].find(
      (link) => link.textContent === '全部待审事项'
    )
    expect(all?.getAttribute('data-active')).toBe(active)
    expect(container.querySelector('h1')?.textContent).toBe('待审事项')
  })

  it('does not overlap timer polling while the previous request is pending', async () => {
    let resolve!: (value: InboxCounts) => void
    mocks.get.mockReturnValue(
      new Promise<InboxCounts>((done) => {
        resolve = done
      })
    )
    await render()
    await act(async () => poll())
    expect(mocks.get).toHaveBeenCalledTimes(1)
    await act(async () => resolve(counts))
  })

  it('keeps last successful counts and exposes a failed refresh', async () => {
    await render()
    mocks.get.mockResolvedValueOnce('当前无法读取计数')
    await act(async () => context.refreshCounts())
    expect(context.counts).toEqual(counts)
    expect(context.countsError).toBe('当前无法读取计数')
    expect(context.countsLoading).toBe(false)
  })

  it('refreshes after a pending request so post-action counts are current', async () => {
    let resolve!: (value: InboxCounts) => void
    mocks.get.mockReturnValueOnce(
      new Promise<InboxCounts>((done) => {
        resolve = done
      })
    )
    await render()
    const newest = { ...counts, todayProcessed: 5 }
    mocks.get.mockResolvedValueOnce(newest)
    let refreshed!: Promise<void>
    await act(async () => {
      refreshed = context.refreshCounts()
    })
    expect(mocks.get).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolve(counts)
      await refreshed
    })
    expect(context.counts).toEqual(newest)
  })

  it('serializes two explicit refreshes that arrive during the same request', async () => {
    const resolutions: Array<(value: InboxCounts) => void> = []
    mocks.get.mockImplementation(
      () => new Promise<InboxCounts>((resolve) => resolutions.push(resolve))
    )
    await render()
    let first!: Promise<void>
    let second!: Promise<void>
    await act(async () => {
      first = context.refreshCounts()
      second = context.refreshCounts()
    })
    await act(async () => resolutions[0](counts))
    expect(mocks.get).toHaveBeenCalledTimes(2)
    await act(async () => resolutions[1](counts))
    await act(async () => {
      if (resolutions[2]) resolutions[2](counts)
      await Promise.all([first, second])
    })
  })

  it('does not start requests from callbacks retained after unmount', async () => {
    await render()
    const refresh = context.refreshCounts
    await act(async () => root.unmount())
    await refresh()
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })

  it('clears all account-specific state after successful logout', async () => {
    await render()
    const button = [...container.querySelectorAll('button')].find(
      (element) => element.textContent === '退出登录'
    )!
    await act(async () => button.click())
    expect(mocks.post).toHaveBeenCalledWith(
      '/user/status/logout',
      expect.anything()
    )
    expect(mocks.logout).toHaveBeenCalledOnce()
    expect(mocks.resetUnread).toHaveBeenCalledOnce()
    expect(mocks.resetSettings).toHaveBeenCalledOnce()
  })

  it('preserves local account state and shows server errors when logout fails', async () => {
    mocks.post.mockResolvedValueOnce('退出失败')
    await render()
    const button = [...container.querySelectorAll('button')].find(
      (element) => element.textContent === '退出登录'
    )!
    await act(async () => button.click())
    expect(mocks.logout).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('退出失败')
    expect(button.disabled).toBe(false)
  })

  it('marks the stats overview entry only on the dashboard home', async () => {
    await render()
    const stats = [...container.querySelectorAll('a')].find(
      (link) => link.textContent === '统计总览'
    )
    expect(stats?.getAttribute('href')).toBe('/dashboard')
    expect(stats?.getAttribute('data-active')).toBe('true')
    expect(container.querySelector('h1')?.textContent).toBe('统计总览')
    const all = [...container.querySelectorAll('a')].find(
      (link) => link.textContent === '全部待审事项'
    )
    expect(all?.getAttribute('href')).toBe('/dashboard/inbox')
    expect(all?.getAttribute('data-active')).toBe('false')
  })
})
