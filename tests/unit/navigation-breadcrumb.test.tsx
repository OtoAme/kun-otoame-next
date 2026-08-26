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

describe('KunNavigationBreadcrumb submission routes', () => {
  // A route with no label in keyLabelMap renders 主页 alone, so every submission
  // page needs an entry there.
  it('labels the submission editor', async () => {
    const markup = await renderBreadcrumb('/submission/12', { id: '12' })

    expect(markup).toContain('投稿游戏条目')
  })

  it('labels the review queue and its detail page', async () => {
    expect(await renderBreadcrumb('/admin/submission')).toContain('投稿审核')
    expect(
      await renderBreadcrumb('/admin/submission/12', { id: '12' })
    ).toContain('投稿详情')
  })

  it('keeps the profile owner breadcrumb on the 发布条目 tab', async () => {
    const markup = await renderBreadcrumb('/user/7/submission', { id: '7' })

    // User pages resolve to the profile crumb; without a label the whole item
    // would be dropped and only 主页 would render.
    expect(markup).toContain('发布条目')
    expect(markup).toContain('主页')
  })
})
