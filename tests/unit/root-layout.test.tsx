import React from 'react'
import { act } from 'react'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

globalThis.React = React

const navigationMock = vi.hoisted(() => ({
  pathname: '/'
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => undefined)
  }))
}))

vi.mock('next/navigation', () => ({
  usePathname: () => navigationMock.pathname
}))

vi.mock('next/script', () => ({
  default: ({ children, id }: { children?: React.ReactNode; id?: string }) => (
    <script id={id}>{children}</script>
  )
}))

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom')>()
  return {
    ...actual,
    preconnect: vi.fn(),
    prefetchDNS: vi.fn()
  }
})

vi.mock('~/components/kun/top-bar/TopBar', () => ({
  KunTopBar: () => <header data-testid="top-bar" />
}))

vi.mock('~/components/kun/Footer', () => ({
  KunFooter: () => <footer data-testid="footer" />
}))

vi.mock('~/components/kun/NavigationBreadcrumb', () => ({
  KunNavigationBreadcrumb: () => <nav data-testid="breadcrumb" />
}))

vi.mock('~/components/kun/BackToTop', () => ({
  KunBackToTop: () => <button data-testid="back-to-top" />
}))

vi.mock('~/components/kun/Toaster', () => ({
  KunToaster: () => <div data-testid="toaster" />
}))

vi.mock('~/components/kun/theme/SiteThemeScript', () => ({
  SiteThemeScript: () => null
}))

vi.mock('~/app/providers', () => ({
  Providers: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="providers">{children}</div>
  )
}))

vi.mock('~/app/actions', () => ({}))

describe('RootLayout content band', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
  })

  it('renders the global footer on regular pages', async () => {
    navigationMock.pathname = '/'

    const { default: RootLayout } = await import('~/app/layout')
    const element = await RootLayout({
      children: <main data-testid="page-content">content</main>
    })

    const markup = renderToStaticMarkup(element)

    expect(markup).toContain('data-testid="footer"')
    expect(markup).toContain('data-testid="back-to-top"')
  })

  it('keeps the root content band stretchable for route-specific layout control', async () => {
    navigationMock.pathname = '/'

    const { default: RootLayout } = await import('~/app/layout')
    const element = await RootLayout({
      children: <main data-testid="page-content">content</main>
    })

    const markup = renderToStaticMarkup(element)

    expect(markup).toContain(
      'flex min-h-[calc(100dvh-256px)] w-full max-w-7xl grow px-3 sm:px-6'
    )
    expect(markup).not.toContain(
      'flex min-h-[calc(100dvh-256px)] w-full max-w-7xl grow items-center px-3 sm:px-6'
    )
  })

  it('removes global footer elements from conversation detail pages', async () => {
    navigationMock.pathname = '/message/chat/12'

    const { default: RootLayout } = await import('~/app/layout')
    const element = await RootLayout({
      children: <main data-testid="page-content">content</main>
    })

    const markup = renderToStaticMarkup(element)

    expect(markup).not.toContain('data-testid="footer"')
    expect(markup).not.toContain('data-testid="back-to-top"')
    expect(markup).toContain('max-lg:min-h-0')
    expect(markup).toContain('max-lg:overflow-hidden')
  })

  it('restores document scrolling after leaving conversation detail pages', async () => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    Object.defineProperty(dom.window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0)
        return 1
      }
    })
    Object.defineProperty(dom.window, 'cancelAnimationFrame', {
      configurable: true,
      value: vi.fn()
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    navigationMock.pathname = '/message/chat/12'

    const { KunRootRouteChrome } = await import(
      '~/components/layout/RootRouteChrome'
    )
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(
        <KunRootRouteChrome>
          <main data-testid="page-content">content</main>
        </KunRootRouteChrome>
      )
    })

    expect(dom.window.document.documentElement.style.overflow).toBe('hidden')
    expect(dom.window.document.body.style.overflow).toBe('hidden')

    navigationMock.pathname = '/'
    await act(async () => {
      root!.render(
        <KunRootRouteChrome>
          <main data-testid="page-content">content</main>
        </KunRootRouteChrome>
      )
    })

    expect(dom.window.document.documentElement.style.overflow).toBe('')
    expect(dom.window.document.body.style.overflow).toBe('')
    expect(dom.window.document.documentElement.style.overflowY).toBe('auto')
    expect(dom.window.document.body.style.overflowY).toBe('auto')
  })

  it('does not restore a released external scroll lock after leaving conversation detail pages', async () => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    Object.defineProperty(dom.window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0)
        return 1
      }
    })
    Object.defineProperty(dom.window, 'cancelAnimationFrame', {
      configurable: true,
      value: vi.fn()
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    navigationMock.pathname = '/message/chat/12'

    const html = dom.window.document.documentElement
    const body = dom.window.document.body
    html.style.overflow = 'hidden'

    const { KunRootRouteChrome } = await import(
      '~/components/layout/RootRouteChrome'
    )
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(
        <KunRootRouteChrome>
          <main data-testid="page-content">content</main>
        </KunRootRouteChrome>
      )
    })

    expect(html.style.overflow).toBe('hidden')
    expect(body.style.overflow).toBe('hidden')

    html.style.overflow = ''

    navigationMock.pathname = '/'
    await act(async () => {
      root!.render(
        <KunRootRouteChrome>
          <main data-testid="page-content">content</main>
        </KunRootRouteChrome>
      )
    })

    expect(html.style.overflow).toBe('')
    expect(body.style.overflow).toBe('')
    expect(html.style.overflowY).toBe('auto')
    expect(body.style.overflowY).toBe('auto')
  })
})
