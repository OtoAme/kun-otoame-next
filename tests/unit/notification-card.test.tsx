import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message } from '~/types/api/message'

const mocks = vi.hoisted(() => ({
  observe: vi.fn(),
  stop: vi.fn(),
  remember: vi.fn(),
  seen: vi.fn(),
  visible: vi.fn(),
  contentReady: true
}))
vi.mock('~/components/kun/SessionContentBoundary', () => ({
  useSessionContentReady: () => mocks.contentReady
}))
vi.mock('~/utils/notificationVisibility', () => ({
  observeNotificationReading: mocks.observe,
  isNotificationCardVisible: mocks.visible
}))
vi.mock('~/utils/notificationReading', () => ({
  notificationEntryHref: (target: string, token: string) =>
    target + '?notification-entry=' + token,
  rememberNotificationEntry: mocks.remember
}))
vi.mock('next/link', () => ({
  default: ({ children, prefetch, ...props }: any) => (
    <a {...props}>{children}</a>
  )
}))
vi.mock('~/components/kun/floating-card/KunAvatar', () => ({
  KunAvatar: () => null
}))
vi.mock('@heroui/card', () => ({
  Card: ({ children, ...props }: any) => (
    <article {...props}>{children}</article>
  ),
  CardBody: ({ children }: any) => <div>{children}</div>
}))
vi.mock('@heroui/avatar', () => ({ Avatar: () => null }))
vi.mock('@heroui/chip', () => ({
  Chip: ({ children }: any) => <span>{children}</span>
}))
vi.mock('@heroui/button', () => ({
  Button: ({ children, onPress, ...props }: any) => (
    <button aria-expanded={props['aria-expanded']} onClick={onPress}>
      {children}
    </button>
  )
}))

let dom: JSDOM
let root: Root
let container: HTMLElement
let MessageCard: (typeof import('~/components/message/MessageCard'))['MessageCard']
const identity = { uid: 7, context: 'card-context', generation: 1 }
const message: Message = {
  id: 80,
  type: 'system',
  content: '完整合成通知正文',
  status: 0,
  link: '/help/4',
  contentVersion: '2',
  created: '2026-11-18T00:00:00Z',
  sender: null
}

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.observe.mockReturnValue(mocks.stop)
  mocks.visible.mockReturnValue(true)
  mocks.contentReady = true
  dom = new JSDOM('<div id="root"></div>', {
    url: 'https://example.test/message/notice'
  })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  ;({ MessageCard } = await import('~/components/message/MessageCard'))
  container = document.getElementById('root')!
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  dom.window.close()
  vi.unstubAllGlobals()
})
const render = async (msg = message, confirmationError?: string) => {
  await act(async () =>
    root.render(
      <MessageCard
        msg={msg}
        identity={identity}
        onSeen={mocks.seen}
        confirmationError={confirmationError}
      />
    )
  )
}

describe('notification card reading controls', () => {
  it('renders a stable notification entry on LAN HTTP without crypto.randomUUID', async () => {
    dom.reconfigure({ url: 'http://192.168.0.199:3000/message/notice' })
    vi.stubGlobal('crypto', {
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto)
    })

    await render()
    const entry = container.querySelector('a')!.href
    expect(new URL(entry).searchParams.get('notification-entry')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    await render({ ...message })
    expect(container.querySelector('a')!.href).toBe(entry)
    await render({ ...message, contentVersion: '3' })
    expect(container.querySelector('a')!.href).not.toBe(entry)
    expect(mocks.seen).not.toHaveBeenCalled()
  })

  it('requires a fresh reading interval after the surrounding content becomes ready', async () => {
    mocks.contentReady = false
    await render()
    expect(mocks.observe).not.toHaveBeenCalled()
    mocks.contentReady = true
    await render()
    expect(mocks.observe).toHaveBeenCalledTimes(1)
    mocks.observe.mock.calls[0][1]()
    const eligible = mocks.seen.mock.calls[0][1]
    expect(eligible()).toBe(true)
    mocks.contentReady = false
    await render()
    expect(mocks.stop).toHaveBeenCalledTimes(1)
    expect(eligible()).toBe(false)
    mocks.contentReady = true
    await render()
    expect(mocks.observe).toHaveBeenCalledTimes(2)
  })

  it('observes a folded long card and confirms immediately when its full body is expanded', async () => {
    const long = { ...message, content: '长通知正文'.repeat(100) }
    await render(long)
    expect(mocks.observe).toHaveBeenCalledTimes(1)
    const button = container.querySelector('button')!
    expect(button.getAttribute('aria-expanded')).toBe('false')
    await act(async () => button.click())
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(mocks.observe.mock.calls[0][0]).toBe(
      container.querySelector('[data-notification-id]')
    )
    expect(mocks.observe.mock.calls[0].slice(2)).toEqual([1000, 'card'])
    expect(mocks.seen).toHaveBeenCalledExactlyOnceWith(long, undefined, true)
    mocks.seen.mockClear()
    mocks.observe.mock.calls[0][1]()
    expect(mocks.seen).toHaveBeenCalledExactlyOnceWith(
      long,
      expect.any(Function)
    )
    const eligible = mocks.seen.mock.calls[0][1]
    expect(eligible()).toBe(true)
    mocks.visible.mockReturnValue(false)
    expect(eligible()).toBe(false)
    mocks.visible.mockReturnValue(true)
    await act(async () => button.click())
    expect(mocks.stop).not.toHaveBeenCalled()
    expect(mocks.seen).toHaveBeenCalledTimes(1)
  })

  it('does not retry already-read cards or failed confirmations without an explicit reload', async () => {
    await render({ ...message, status: 1 })
    expect(mocks.observe).not.toHaveBeenCalled()
    await render(message, '阅读确认失败，请刷新页面后重试')
    expect(mocks.observe).not.toHaveBeenCalled()
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      '刷新页面'
    )
  })

  it('registers only concrete entry metadata for ordinary and new-tab links without reading on click', async () => {
    await render()
    const link = container.querySelector('a')!
    expect(link.href).toContain('notification-entry=')
    await act(async () =>
      link.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true
        })
      )
    )
    expect(mocks.remember).toHaveBeenCalledWith(expect.any(String), {
      identity,
      item: { id: 80, version: '2' },
      target: '/help/4'
    })
    expect(mocks.seen).not.toHaveBeenCalled()
  })
})
