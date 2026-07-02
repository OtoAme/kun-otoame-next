import React from 'react'
import { act } from 'react'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

globalThis.React = React

const navigationMock = vi.hoisted(() => ({
  pathname: '/message/chat'
}))

vi.mock('next/navigation', () => ({
  usePathname: () => navigationMock.pathname
}))

vi.mock('~/components/message/MessageNav', () => ({
  MessageNav: ({ className }: { className?: string }) => (
    <nav className={className} data-testid="message-nav">
      nav
    </nav>
  )
}))

vi.mock('~/components/kun/Header', () => ({
  KunHeader: ({
    name,
    description
  }: {
    name: string
    description?: string
  }) => (
    <header data-testid="message-header">
      <h1>{name}</h1>
      {description && <p>{description}</p>}
    </header>
  )
}))

const renderMessageLayout = async (pathname: string) => {
  navigationMock.pathname = pathname

  const { default: MessageLayout } = await import('~/app/message/layout')

  return renderToStaticMarkup(
    <MessageLayout>
      <main data-testid="message-content">content</main>
    </MessageLayout>
  )
}

describe('message layout shell', () => {
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

  it('keeps the message title and description on message list pages', async () => {
    const markup = await renderMessageLayout('/message/chat')

    expect(markup).toContain('data-testid="message-header"')
    expect(markup).toContain('消息')
    expect(markup).toContain('第一次访问对应的页面会自动已读所有消息')
    expect(markup).toContain('container mx-auto my-4')
    expect(markup).toContain('flex flex-col my-4 gap-6 lg:flex-row')
    expect(markup).toContain('<nav data-testid="message-nav">nav</nav>')
    expect(markup).not.toContain(
      'min-h-[calc(100dvh-256px)] flex-col justify-center'
    )
    expect(markup).not.toContain('max-lg:hidden')
  })

  it('uses a viewport-contained shell without the message header on conversation detail pages', async () => {
    const markup = await renderMessageLayout('/message/chat/12')

    expect(markup).not.toContain('data-testid="message-header"')
    expect(markup).not.toContain('overflow-hidden')
    expect(markup).toContain('overflow-visible')
    expect(markup).toContain(
      'container mx-auto min-h-[calc(100dvh-256px)] w-full overflow-visible pt-[var(--message-chat-top-reserve)]'
    )
    expect(markup).toContain('--message-chat-top-reserve:3dvh')
    expect(markup).toContain(
      'flex w-full flex-col gap-6 overflow-visible lg:flex-row lg:items-start'
    )
    expect(markup).toContain(
      '<nav class="max-lg:hidden" data-testid="message-nav">nav</nav>'
    )
    expect(markup).not.toContain('items-center')
    expect(markup).not.toContain('justify-center')
    expect(markup).toContain('<div class="w-full lg:w-3/4">')
  })

  it('leaves document scrolling to the root route chrome', async () => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    navigationMock.pathname = '/message/chat/12'

    const { MessageLayoutChrome } = await import(
      '~/components/message/MessageLayoutChrome'
    )
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(
        <MessageLayoutChrome>
          <main data-testid="message-content">content</main>
        </MessageLayoutChrome>
      )
    })

    expect(dom.window.document.documentElement.style.overflow).toBe('')
    expect(dom.window.document.body.style.overflow).toBe('')

    await act(async () => {
      root?.unmount()
    })
    root = undefined

    expect(dom.window.document.documentElement.style.overflow).toBe('')
    expect(dom.window.document.body.style.overflow).toBe('')
  })

  it('syncs the conversation detail height with visualViewport changes', async () => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    const win = dom.window
    const visualViewport = new win.EventTarget()
    Object.defineProperty(visualViewport, 'height', {
      configurable: true,
      value: 520
    })
    Object.defineProperty(win, 'visualViewport', {
      configurable: true,
      value: visualViewport
    })
    vi.stubGlobal('window', win)
    vi.stubGlobal('document', win.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    navigationMock.pathname = '/message/chat/12'

    const { MessageLayoutChrome } = await import(
      '~/components/message/MessageLayoutChrome'
    )
    const container = win.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(
        <MessageLayoutChrome>
          <main data-testid="message-content">content</main>
        </MessageLayoutChrome>
      )
    })

    expect(
      win.document.documentElement.style.getPropertyValue(
        '--message-chat-visual-viewport-height'
      )
    ).toBe('520px')

    Object.defineProperty(visualViewport, 'height', {
      configurable: true,
      value: 360
    })
    await act(async () => {
      visualViewport.dispatchEvent(new win.Event('resize'))
    })

    expect(
      win.document.documentElement.style.getPropertyValue(
        '--message-chat-visual-viewport-height'
      )
    ).toBe('360px')

    await act(async () => {
      root?.unmount()
    })
    root = undefined

    expect(
      win.document.documentElement.style.getPropertyValue(
        '--message-chat-visual-viewport-height'
      )
    ).toBe('')
  })
})
