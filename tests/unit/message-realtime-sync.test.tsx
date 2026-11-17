import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'

const fetchMock = vi.hoisted(() => ({ kunFetchGet: vi.fn(), pathname: '/' }))
vi.mock('~/utils/kunFetch', async (original) => ({
  ...(await original<typeof import('~/utils/kunFetch')>()),
  kunFetchGet: fetchMock.kunFetchGet
}))
vi.mock('next/navigation', () => ({ usePathname: () => fetchMock.pathname }))

let root: Root | undefined
let dom: JSDOM
const tick = (delay = 0) => act(() => vi.advanceTimersByTimeAsync(delay))
const renderSync = async (status = 'authenticated', seed = false) => {
  const { useUserStore } = await import('~/store/userStore')
  const { useMessageStore } = await import('~/store/messageStore')
  useUserStore.setState({
    user: { ...useUserStore.getState().user, uid: 7 },
    sessionStatus: status as 'authenticated',
    sessionContext: 'ctx-a',
    sessionGeneration: 1
  })
  useMessageStore.getState().resetUnreadMessageStatus()
  if (seed) {
    const { seedSessionUnread } = await import('~/utils/messageSync')
    seedSessionUnread(
      { context: 'ctx-a', generation: 1 },
      { hasUnreadNotification: true, hasUnreadConversation: true }
    )
  }
  const { MessageRealtimeSync } = await import(
    '~/components/message/MessageRealtimeSync'
  )
  root = createRoot(document.getElementById('root')!)
  await act(() => root!.render(<MessageRealtimeSync />))
  await tick()
  return { useUserStore, useMessageStore }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  fetchMock.pathname = '/'
  fetchMock.kunFetchGet
    .mockReset()
    .mockResolvedValue({ hasUnreadMessages: true, hasUnreadChat: false })
  dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('navigator', dom.window.navigator)
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})
afterEach(async () => {
  if (root) await act(() => root!.unmount())
  root = undefined
  dom.window.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.resetModules()
})

describe('MessageRealtimeSync', () => {
  it('keeps ten active minutes within twelve summary requests', async () => {
    const { useMessageStore } = await renderSync()
    for (let minute = 0; minute < 10; minute++) {
      await tick(60_000)
      await act(() => {
        window.dispatchEvent(new dom.window.Event('scroll'))
      })
    }
    expect(fetchMock.kunFetchGet).toHaveBeenCalledTimes(11)
    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith(
      '/message/unread',
      undefined,
      expect.objectContaining({
        timeout: 15_000,
        preserveErrorStatus: true,
        signal: expect.anything()
      })
    )
    expect(useMessageStore.getState().hasUnreadNotification).toBe(true)
  })
  it.each(['checking', 'guest', 'unavailable'])(
    'does not schedule for %s identity',
    async (status) => {
      await renderSync(status)
      await tick(600_000)
      expect(fetchMock.kunFetchGet).not.toHaveBeenCalled()
    }
  )
  it('reuses the successful session summary without a duplicate initialization read', async () => {
    const { useMessageStore } = await renderSync('authenticated', true)
    expect(fetchMock.kunFetchGet).not.toHaveBeenCalled()
    expect(useMessageStore.getState().hasUnreadConversation).toBe(true)
    await tick(59_999)
    expect(fetchMock.kunFetchGet).not.toHaveBeenCalled()
    await tick(1)
    expect(fetchMock.kunFetchGet).toHaveBeenCalledTimes(1)
  })
  it('pauses hidden and offline and merges a recovery event storm', async () => {
    await renderSync()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden'
    })
    await act(() => {
      document.dispatchEvent(new dom.window.Event('visibilitychange'))
    })
    await tick(180_000)
    expect(fetchMock.kunFetchGet).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    })
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false
    })
    await act(() => {
      window.dispatchEvent(new dom.window.Event('offline'))
      document.dispatchEvent(new dom.window.Event('visibilitychange'))
    })
    await tick(180_000)
    expect(fetchMock.kunFetchGet).toHaveBeenCalledTimes(1)
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true
    })
    await act(() => {
      window.dispatchEvent(new dom.window.Event('online'))
      window.dispatchEvent(new dom.window.Event('focus'))
    })
    await tick()
    expect(fetchMock.kunFetchGet).toHaveBeenCalledTimes(2)
  })
  it('stops ordinary idle pages and continues foreground private chat', async () => {
    await renderSync()
    await tick(300_000)
    const idleCount = fetchMock.kunFetchGet.mock.calls.length
    await tick(300_000)
    expect(fetchMock.kunFetchGet).toHaveBeenCalledTimes(idleCount)
    await act(() => root!.unmount())
    root = undefined
    fetchMock.kunFetchGet.mockClear()
    fetchMock.pathname = '/message/chat/5'
    await renderSync()
    await tick(600_000)
    expect(fetchMock.kunFetchGet).toHaveBeenCalledTimes(11)
  })
  it('uses authoritative session recovery on 401 and preserves an unavailable account', async () => {
    const { KunFetchError } = await import('~/utils/kunFetch')
    fetchMock.kunFetchGet.mockRejectedValueOnce(
      new KunFetchError('unauthorized', 'http', 401)
    )
    const sessionTransport = vi
      .fn()
      .mockResolvedValue(
        Response.json({ code: 'SESSION_UNAVAILABLE' }, { status: 503 })
      )
    vi.stubGlobal('fetch', sessionTransport)
    const { useUserStore } = await renderSync()
    await tick()
    expect(sessionTransport).toHaveBeenCalledTimes(1)
    expect(useUserStore.getState()).toMatchObject({
      user: { uid: 7 },
      sessionStatus: 'unavailable'
    })
    await tick(600_000)
    expect(fetchMock.kunFetchGet).toHaveBeenCalledTimes(1)
  })
  it('retains flags and success time for invalid summaries and rate limits', async () => {
    const { KunFetchError } = await import('~/utils/kunFetch')
    fetchMock.kunFetchGet.mockRejectedValueOnce(
      new KunFetchError('rate', 'http', 429, 120_000)
    )
    const { useMessageStore } = await renderSync()
    useMessageStore.getState().setUnreadMessageStatus({
      hasUnreadNotification: true,
      hasUnreadConversation: true
    })
    for (let count = 0; count < 10; count++) {
      await act(() => {
        window.dispatchEvent(new dom.window.Event('focus'))
      })
      await tick(5_000)
    }
    expect(fetchMock.kunFetchGet).toHaveBeenCalledTimes(1)
    expect(useMessageStore.getState()).toMatchObject({
      hasUnreadNotification: true,
      hasUnreadConversation: true
    })
  })
  it.each(['resolve', 'reject'])(
    'isolates a late %s across a same-account new session',
    async (outcome) => {
      let resolve!: (value: unknown) => void
      let reject!: (error: unknown) => void
      fetchMock.kunFetchGet.mockImplementationOnce(
        () =>
          new Promise((done, fail) => {
            resolve = done
            reject = fail
          })
      )
      const { useUserStore, useMessageStore } = await renderSync()
      await act(() => {
        useUserStore.setState({ sessionContext: 'ctx-b', sessionGeneration: 2 })
      })
      const { seedSessionUnread } = await import('~/utils/messageSync')
      await act(() => {
        seedSessionUnread(
          { context: 'ctx-b', generation: 2 },
          { hasUnreadNotification: false, hasUnreadConversation: false }
        )
      })
      if (outcome === 'resolve')
        resolve({ hasUnreadMessages: true, hasUnreadChat: true })
      else {
        const { KunFetchError } = await import('~/utils/kunFetch')
        reject(new KunFetchError('old unauthorized', 'http', 401))
      }
      await tick()
      expect(useMessageStore.getState()).toMatchObject({
        hasUnreadNotification: false,
        hasUnreadConversation: false
      })
      expect(useUserStore.getState().sessionStatus).toBe('authenticated')
    }
  )
  it('keeps Retry-After across checking and unavailable states of the same session', async () => {
    const { KunFetchError } = await import('~/utils/kunFetch')
    fetchMock.kunFetchGet.mockRejectedValueOnce(
      new KunFetchError('rate', 'http', 429, 180_000)
    )
    const { useUserStore } = await renderSync()
    for (const sessionStatus of [
      'checking',
      'authenticated',
      'unavailable',
      'authenticated'
    ] as const) {
      await act(() => {
        useUserStore.setState({ sessionStatus })
      })
      await act(() => {
        window.dispatchEvent(new dom.window.Event('focus'))
      })
      await tick(5_000)
    }
    await tick(159_999)
    expect(fetchMock.kunFetchGet).toHaveBeenCalledTimes(1)
    await tick(1)
    expect(fetchMock.kunFetchGet).toHaveBeenCalledTimes(2)
  })
})
