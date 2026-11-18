import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  resolve: vi.fn(),
  current: true,
  visible: true,
  observers: [] as {
    target: HTMLElement
    read: () => void
    stop: ReturnType<typeof vi.fn>
  }[]
}))
vi.mock('next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search)
}))
vi.mock('~/utils/notificationReading', () => ({
  NOTIFICATION_ENTRY_PARAMETER: 'notification-entry',
  isCurrentNotificationIdentity: () => mocks.current,
  resolveNotificationEntry: mocks.resolve,
  confirmNotificationItems: mocks.confirm
}))
vi.mock('~/utils/notificationVisibility', () => ({
  isNotificationBodyVisible: () => mocks.visible,
  observeNotificationReading: (target: HTMLElement, read: () => void) => {
    const stop = vi.fn()
    mocks.observers.push({ target, read, stop })
    return stop
  }
}))

let dom: JSDOM
let root: Root
let container: HTMLElement
let NotificationTargetReady: (typeof import('~/components/message/NotificationTargetReady'))['NotificationTargetReady']
let useUserStore: (typeof import('~/store/userStore'))['useUserStore']
const identity = { uid: 7, context: 'target-context', generation: 1 }
const entry = {
  identity,
  item: { id: 80, version: '2' },
  target: '/help/4#answer-8',
  enteredAt: 1
}

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.current = true
  mocks.visible = true
  mocks.observers = []
  mocks.resolve.mockReset().mockResolvedValue(entry)
  mocks.confirm.mockReset().mockResolvedValue([{ id: 80, outcome: 'read' }])
  dom = new JSDOM('<div id="root"></div>', {
    url: 'https://example.test/help/4?notification-entry=token#answer-8'
  })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('MutationObserver', dom.window.MutationObserver)
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  ;({ useUserStore } = await import('~/store/userStore'))
  useUserStore.setState({
    user: { ...useUserStore.getState().user, uid: 7 },
    sessionStatus: 'authenticated',
    sessionContext: identity.context,
    sessionGeneration: 1
  })
  ;({ NotificationTargetReady } = await import(
    '~/components/message/NotificationTargetReady'
  ))
  container = document.getElementById('root')!
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  dom.window.close()
  vi.unstubAllGlobals()
})
const render = async (success = true, path = '/help/4') => {
  await act(async () =>
    root.render(
      <main>
        {success ? (
          <>
            <article id="answer-8">已授权加载的回答正文</article>
            <NotificationTargetReady path={path} />
          </>
        ) : (
          <p role="alert">目标加载失败</p>
        )}
      </main>
    )
  )
}

describe('notification target successful presentation', () => {
  it('confirms only its concrete entry after the successful target satisfies actual reading', async () => {
    await render()
    expect(mocks.observers).toHaveLength(1)
    expect(mocks.observers[0].target.id).toBe('answer-8')
    expect(mocks.confirm).not.toHaveBeenCalled()
    await act(async () => mocks.observers[0].read())
    expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith(
      identity,
      [entry.item],
      entry.target
    )
  })

  it('does not confirm a direct visit, failed target or a different selected target', async () => {
    await render(false)
    expect(mocks.observers).toHaveLength(0)
    await render(true, '/help/5')
    expect(mocks.observers).toHaveLength(0)
    dom.reconfigure({ url: 'https://example.test/help/4#answer-8' })
    await render()
    expect(mocks.observers).toHaveLength(0)
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('waits for the addressed content instead of confirming a surrounding success page', async () => {
    dom.reconfigure({
      url: 'https://example.test/help/4?notification-entry=token#answer-9'
    })
    await render()
    expect(mocks.observers).toHaveLength(0)
    const answer = document.createElement('article')
    answer.id = 'answer-9'
    await act(async () => {
      container.append(answer)
      await Promise.resolve()
    })
    expect(mocks.observers[0].target).toBe(answer)
  })

  it('ignores metadata that arrives after leaving the page or changing account', async () => {
    let resolve!: (value: unknown) => void
    mocks.resolve.mockReturnValueOnce(
      new Promise((complete) => {
        resolve = complete
      })
    )
    await render()
    await act(async () => mocks.observers[0].read())
    mocks.current = false
    await act(async () => resolve(entry))
    expect(mocks.confirm).not.toHaveBeenCalled()
    mocks.current = true
    await render(false)
    expect(mocks.observers[0].stop).toHaveBeenCalled()
  })

  it('requires a fresh visible interval if an overlay arrives during the metadata lookup', async () => {
    let resolve!: (value: unknown) => void
    mocks.resolve.mockReturnValueOnce(
      new Promise((complete) => {
        resolve = complete
      })
    )
    await render()
    await act(async () => mocks.observers[0].read())
    mocks.visible = false
    await act(async () => resolve(entry))
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.observers).toHaveLength(2)
    mocks.visible = true
    await act(async () => mocks.observers[1].read())
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
  })

  it('does not reuse a completed visible interval after the tab briefly loses focus', async () => {
    let resolve!: (value: unknown) => void
    mocks.resolve.mockReturnValueOnce(
      new Promise((complete) => {
        resolve = complete
      })
    )
    await render()
    await act(async () => mocks.observers[0].read())
    window.dispatchEvent(new dom.window.Event('blur'))
    window.dispatchEvent(new dom.window.Event('focus'))
    await act(async () => resolve(entry))
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.observers).toHaveLength(2)
  })

  it('ignores malformed fragments without crashing a successful detail page', async () => {
    dom.reconfigure({
      url: 'https://example.test/help/4?notification-entry=token#%xy'
    })
    await expect(render()).resolves.toBeUndefined()
    expect(mocks.observers).toHaveLength(0)
    expect(mocks.confirm).not.toHaveBeenCalled()
  })
})
