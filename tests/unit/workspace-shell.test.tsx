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
})
