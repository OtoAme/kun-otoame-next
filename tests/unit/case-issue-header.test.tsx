import React from 'react'
import { JSDOM } from 'jsdom'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { IssueHeader } from '~/components/dashboard/issue/IssueHeader'
import { kunMoyuMoe } from '~/config/moyu-moe'

globalThis.React = React

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

describe('issue header', () => {
  it('leads with the site icon beside the site name, linked home', () => {
    const doc = new JSDOM(renderToStaticMarkup(<IssueHeader user={null} />))
      .window.document
    const home = doc.querySelector('header a[href="/"]')!
    const icon = home.querySelector('img')!

    // 与站点顶栏同一张网站图标；旁边已有站点名，图标只作装饰，链接名只读站点名
    expect(icon.getAttribute('src')).toContain('favicon.webp')
    expect(icon.getAttribute('alt')).toBe('')
    expect(home.textContent).toBe(kunMoyuMoe.titleShort)
    expect(home.querySelector('svg')).toBeNull()
  })
})
