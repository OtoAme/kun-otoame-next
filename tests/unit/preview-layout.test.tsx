import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

globalThis.React = React

const forbidden = vi.hoisted(() => ({
  message: vi.fn(() => null),
  shoutbox: vi.fn(({ children }: { children: React.ReactNode }) => children),
  toast: vi.fn(() => null),
  themeSync: vi.fn(() => null)
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => undefined)
  }))
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() })
}))

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom')>()
  return {
    ...actual,
    preconnect: vi.fn(),
    prefetchDNS: vi.fn()
  }
})

vi.mock('~/components/kun/theme/SiteThemeScript', () => ({
  SiteThemeScript: () => <script data-testid="site-theme-script" />
}))

vi.mock('~/components/message/MessageRealtimeSync', () => ({
  MessageRealtimeSync: forbidden.message
}))

vi.mock('~/components/shoutbox/query/ShoutboxQueryProvider', () => ({
  ShoutboxQueryProvider: forbidden.shoutbox
}))

vi.mock('~/components/kun/theme/SiteThemeRouteSync', () => ({
  SiteThemeRouteSync: forbidden.themeSync
}))

vi.mock('@heroui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@heroui/react')>()
  return {
    ...actual,
    ToastProvider: forbidden.toast
  }
})

vi.mock('@bprogress/next', () => ({
  AppProgressProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="preview-progress">{children}</div>
  )
}))

vi.mock('@heroui/system', () => ({
  HeroUIProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="preview-heroui">{children}</div>
  )
}))

vi.mock('next-themes', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="preview-theme">{children}</div>
  )
}))

describe('admin preview root layout', () => {
  it('wraps the card in the measured marker with site theme and no site chrome', async () => {
    const { default: PreviewLayout } = await import('~/app/(preview)/layout')
    const markup = renderToStaticMarkup(
      await PreviewLayout({
        children: <main data-testid="preview-content">预览正文</main>
      })
    )

    expect(markup).toContain('data-kun-theme')
    expect(markup).toContain('data-testid="site-theme-script"')
    expect(markup).toContain('data-testid="preview-heroui"')
    expect(markup).toContain('data-testid="preview-theme"')
    expect(markup).toMatch(
      /<div data-admin-preview-content="[^"]*" class="flow-root[^"]*"><main data-testid="preview-content">/
    )
    expect(markup).not.toContain('googletagmanager')
    expect(markup).not.toContain('uma.209911')
    expect(markup).not.toContain('data-testid="footer"')
    expect(markup).not.toContain('data-testid="top-bar"')
    expect(forbidden.message).not.toHaveBeenCalled()
    expect(forbidden.shoutbox).not.toHaveBeenCalled()
    expect(forbidden.toast).not.toHaveBeenCalled()
    expect(forbidden.themeSync).not.toHaveBeenCalled()
  })
})
