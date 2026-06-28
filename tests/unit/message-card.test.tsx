import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { Message } from '~/types/api/message'

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

vi.mock('@heroui/card', () => ({
  Card: ({
    children,
    as: Component = 'div',
    href,
    className
  }: {
    children?: React.ReactNode
    as?: React.ElementType
    href?: string
    className?: string
  }) => (
    <Component href={href} className={className}>
      {children}
    </Component>
  ),
  CardBody: ({
    children,
    className
  }: {
    children?: React.ReactNode
    className?: string
  }) => <div className={className}>{children}</div>
}))

vi.mock('@heroui/avatar', () => ({
  Avatar: ({ name }: { name?: string }) => <span>{name}</span>
}))

vi.mock('@heroui/chip', () => ({
  Chip: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  )
}))

vi.mock('~/components/kun/floating-card/KunAvatar', () => ({
  KunAvatar: () => <span>avatar</span>
}))

describe('MessageCard', () => {
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
    vi.resetModules()
  })

  it('preserves line breaks in notification content as plain text', async () => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { MessageCard } = await import('~/components/message/MessageCard')
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    const content =
      '管理员修改了你发布的游戏资源「修正后的资源」。\n\n修改内容:\n- 类型: PC游戏 -> 手机游戏'
    const message: Message = {
      id: 1,
      type: 'system',
      content,
      status: 0,
      link: '/abc12345',
      created: '2026-06-29T00:00:00.000Z',
      sender: null
    }

    root = createRoot(container!)
    await act(async () => {
      root!.render(<MessageCard msg={message} />)
    })

    const contentNode = dom.window.document.querySelector(
      '[data-testid="message-content"]'
    )
    expect(contentNode?.textContent).toBe(content)
    expect(contentNode?.className).toContain('whitespace-pre-wrap')
    expect(contentNode?.className).toContain('break-words')
  })
})
