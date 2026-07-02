import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

globalThis.React = React

const navigationMock = vi.hoisted(() => ({
  pathname: '/message/chat',
  params: {} as Record<string, string>
}))

vi.mock('next/navigation', () => ({
  usePathname: () => navigationMock.pathname,
  useParams: () => navigationMock.params
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

const renderBreadcrumb = async (
  pathname: string,
  params: Record<string, string> = {}
) => {
  navigationMock.pathname = pathname
  navigationMock.params = params

  const { KunNavigationBreadcrumb } = await import(
    '~/components/kun/NavigationBreadcrumb'
  )

  return renderToStaticMarkup(<KunNavigationBreadcrumb />)
}

describe('KunNavigationBreadcrumb message routes', () => {
  it('keeps breadcrumbs on the private-message list page', async () => {
    const markup = await renderBreadcrumb('/message/chat')

    expect(markup).toContain('aria-label="Breadcrumb"')
    expect(markup).toContain('私聊消息')
  })

  it('hides breadcrumbs on conversation detail pages', async () => {
    const markup = await renderBreadcrumb('/message/chat/12', {
      conversationId: '12'
    })

    expect(markup).toBe('')
  })
})
