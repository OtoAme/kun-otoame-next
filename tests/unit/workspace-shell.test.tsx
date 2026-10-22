import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.React = React

const nav = vi.hoisted(() => ({ pathname: '/workspace/resources' }))
const fetchMock = vi.hoisted(() => ({
  kunFetchGet: vi.fn(),
  kunFetchPost: vi.fn()
}))

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
}))
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    'aria-current': ariaCurrent
  }: {
    children?: React.ReactNode
    href: string
    'aria-current'?: React.AriaAttributes['aria-current']
  }) => (
    <a href={href} aria-current={ariaCurrent}>
      {children}
    </a>
  )
}))
vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt?: string; src: string }) => (
    <img alt={alt ?? ''} src={src} />
  )
}))
vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: fetchMock.kunFetchGet,
  kunFetchPost: fetchMock.kunFetchPost
}))

describe('workspace shell', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    nav.pathname = '/workspace/resources/9'
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
      // 焦点圈在卸载时用 setTimeout 派发事件，要在撤掉 document 替身之前跑完。
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
  })

  const mount = async () => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/workspace/resources/9'
    })
    const element = dom.window.Element.prototype
    if (!element.hasPointerCapture) {
      element.hasPointerCapture = () => false
      element.setPointerCapture = () => {}
      element.releasePointerCapture = () => {}
    }
    dom.window.HTMLElement.prototype.scrollIntoView = () => {}
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    for (const key of [
      'HTMLElement',
      'HTMLInputElement',
      'HTMLButtonElement',
      'HTMLAnchorElement',
      'Element',
      'Node',
      'NodeFilter',
      'MutationObserver',
      'CustomEvent',
      'Event',
      'SVGElement'
    ] as const) {
      vi.stubGlobal(key, dom.window[key])
    }
    vi.stubGlobal('getComputedStyle', (element: Element) =>
      dom!.window.getComputedStyle(element)
    )
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    // Radix 在模块求值时决定是否启用 layout effect；document 必须先就位。
    const { WorkspaceShell } = await import(
      '~/components/dashboard/workspace/WorkspaceShell'
    )
    const { createRoot } = await import('react-dom/client')
    const container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(
        <WorkspaceShell user={{ id: 4, name: '作者', role: 1 }}>
          <p>工作台正文</p>
        </WorkspaceShell>
      )
    })
    return container
  }

  it('marks the resource section current and does not load site counters', async () => {
    const container = await mount()
    const navEl = container.querySelector('nav[aria-label="用户工作台"]')!
    expect(
      navEl
        .querySelector('a[href="/workspace/resources"]')
        ?.getAttribute('aria-current')
    ).toBe('page')
    expect(
      navEl
        .querySelector('a[href="/workspace/entries"]')
        ?.hasAttribute('aria-current')
    ).toBe(false)
    expect(
      navEl.querySelector('a[href="/workspace/issues"]')?.textContent
    ).toBe('问题处理')
    expect(
      container.querySelector('a[href="/"] img')?.getAttribute('src')
    ).toBe('/favicon.webp')
    expect(container.textContent).toContain('工作台正文')
    expect(container.textContent).toContain('作者')
    expect(container.textContent).not.toContain('管理后台')
    expect(container.textContent).not.toContain('DashboardShell')
    expect(fetchMock.kunFetchGet).not.toHaveBeenCalled()
    expect(fetchMock.kunFetchPost).not.toHaveBeenCalled()
    expect(navEl.className).toContain('hidden')
    expect(navEl.className).toContain('sm:flex')
    expect(navEl.className).not.toContain('flex-wrap')
    const menuButton = container.querySelector(
      'button[aria-label="打开导航"]'
    ) as HTMLButtonElement
    expect(menuButton.className).toContain('sm:hidden')
    expect(container.querySelector('header > div')?.className).not.toContain(
      'flex-wrap'
    )
  })

  it('opens the narrow-screen section menu without leaving the top bar', async () => {
    const container = await mount()
    const menuButton = container.querySelector(
      'button[aria-label="打开导航"]'
    ) as HTMLButtonElement
    await act(async () => {
      menuButton.click()
    })
    const dialog = dom!.window.document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('用户工作台')
    expect(
      dialog
        ?.querySelector('a[href="/workspace/resources"]')
        ?.getAttribute('aria-current')
    ).toBe('page')
    expect(
      dialog?.querySelector('a[href="/workspace/entries"]')?.textContent
    ).toBe('我的条目')
    expect(
      dialog?.querySelector('a[href="/workspace/issues"]')?.textContent
    ).toBe('问题处理')
    expect(menuButton.getAttribute('aria-label')).toBe('关闭导航')
  })

  it('names status failures and does not invent a request id', async () => {
    await mount()
    const { workspaceActionError } = await import(
      '~/components/dashboard/workspace/WorkspaceShell'
    )
    const fallback = '网络错误，保存失败，请重试'
    expect(workspaceActionError(new Error('failed to fetch'), fallback)).toBe(
      fallback
    )
    expect(
      workspaceActionError(new Error('failed to fetch'), fallback)
    ).not.toMatch(/request id/i)
    expect(
      workspaceActionError(new Error('Kun Fetch error! Status: 401'), fallback)
    ).toBe('登录已失效，请重新登录后再试')
    expect(
      workspaceActionError(new Error('Kun Fetch error! Status: 403'), fallback)
    ).toBe('没有权限完成这个操作')
    expect(
      workspaceActionError(new Error('Kun Fetch error! Status: 404'), fallback)
    ).toBe('内容不存在或已不可用')
    expect(
      workspaceActionError(new Error('Kun Fetch error! Status: 409'), fallback)
    ).toBe('内容已变化，请载入最新内容后再试')
    expect(
      workspaceActionError(new Error('Kun Fetch error! Status: 429'), fallback)
    ).toBe('操作过于频繁，请稍后重试')
    expect(
      workspaceActionError(new Error('Kun Fetch error! Status: 503'), fallback)
    ).toBe('服务器暂时无法完成操作，请稍后重试')
    expect(
      workspaceActionError(
        new Error(
          'Kun Fetch error! Status: 503; Message: 暂时无法完成操作，请稍后重试 req-9'
        ),
        fallback
      )
    ).toBe('暂时无法完成操作，请稍后重试 req-9')
    expect(
      workspaceActionError(
        new Error('Kun Fetch error! Status: 409; Message: 别人改过了'),
        fallback
      )
    ).toBe('别人改过了')
  })

  it('re-exports the server user and keeps the strict hook', async () => {
    const container = await mount()
    const shell = await import(
      '~/components/dashboard/workspace/WorkspaceShell'
    )
    const context = await import(
      '~/components/dashboard/workspace/WorkspaceUserContext'
    )

    function Outside() {
      let message = 'no-throw'
      try {
        shell.useWorkspaceUser()
      } catch (error) {
        message = error instanceof Error ? error.message : 'unknown'
      }
      const optional = context.useOptionalWorkspaceUser()
      return <p>{`${message}|${optional ? 'present' : 'absent'}`}</p>
    }

    function Inside() {
      const required = shell.useWorkspaceUser()
      const optional = context.useOptionalWorkspaceUser()
      return <p>{`${required.id}:${optional?.id}:${optional?.role}`}</p>
    }

    await act(async () => {
      root!.render(<Outside />)
    })
    expect(container.textContent).toContain(
      'useWorkspaceUser must be used within WorkspaceShell|absent'
    )

    await act(async () => {
      root!.render(
        <shell.WorkspaceUserProvider user={{ id: 4, name: '作者', role: 1 }}>
          <Inside />
        </shell.WorkspaceUserProvider>
      )
    })
    expect(container.textContent).toContain('4:4:1')
  })
})
