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

import { WorkspaceShell } from '~/components/dashboard/workspace/WorkspaceShell'

describe('workspace shell', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    nav.pathname = '/workspace/resources/9'
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
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
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
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
      navEl.querySelector('a[href="/workspace/resources"]')?.getAttribute(
        'aria-current'
      )
    ).toBe('page')
    expect(
      navEl.querySelector('a[href="/workspace/entries"]')?.hasAttribute(
        'aria-current'
      )
    ).toBe(false)
    expect(
      navEl.querySelector('a[href="/workspace/issues"]')?.textContent
    ).toBe('问题处理')
    expect(container.querySelector('a[href="/"] img')?.getAttribute('src')).toBe(
      '/favicon.webp'
    )
    expect(container.textContent).toContain('工作台正文')
    expect(container.textContent).toContain('作者')
    expect(container.textContent).not.toContain('管理后台')
    expect(container.textContent).not.toContain('DashboardShell')
    expect(fetchMock.kunFetchGet).not.toHaveBeenCalled()
    expect(fetchMock.kunFetchPost).not.toHaveBeenCalled()
  })
})
