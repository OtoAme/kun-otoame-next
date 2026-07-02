import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

globalThis.React = React

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => undefined)
  }))
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
  it('keeps the root content band stretchable for route-specific layout control', async () => {
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
})
