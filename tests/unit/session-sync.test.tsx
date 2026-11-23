import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dom: JSDOM
let root: Root
const transport = vi.fn()

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-23T00:00:00Z'))
  transport.mockReset()
  transport.mockImplementation(async () => Response.json({ status: 'guest' }))
  dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test' })
  vi.stubGlobal('React', React)
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('localStorage', dom.window.localStorage)
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('fetch', transport)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  root = createRoot(document.getElementById('root')!)
})

afterEach(async () => {
  await act(async () => root.unmount())
  dom.window.close()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('session restoration entry points', () => {
  it('performs one initial check and merges history, network and restored-page events', async () => {
    const { SessionSync } = await import('~/components/kun/SessionSync')
    const { useUserStore } = await import('~/store/userStore')
    await act(async () => root.render(<SessionSync />))
    expect(transport).toHaveBeenCalledTimes(1)
    expect(useUserStore.getState().sessionStatus).toBe('guest')

    vi.setSystemTime(new Date('2026-11-23T00:00:06Z'))
    await act(async () => {
      window.dispatchEvent(
        new dom.window.PageTransitionEvent('pageshow', { persisted: false })
      )
      document.dispatchEvent(new dom.window.Event('visibilitychange'))
      window.dispatchEvent(new dom.window.Event('focus'))
    })
    expect(transport).toHaveBeenCalledTimes(1)

    await act(async () => {
      window.dispatchEvent(
        new dom.window.PageTransitionEvent('pageshow', { persisted: true })
      )
      window.dispatchEvent(new dom.window.Event('online'))
      window.dispatchEvent(new dom.window.PopStateEvent('popstate'))
    })
    expect(transport).toHaveBeenCalledTimes(2)
    expect(useUserStore.getState().sessionGeneration).toBe(0)

    await act(async () => {
      window.dispatchEvent(
        new dom.window.StorageEvent('storage', {
          key: 'kun-session-change',
          newValue: 'synthetic-session-change'
        })
      )
    })
    expect(transport).toHaveBeenCalledTimes(3)
    expect(useUserStore.getState().sessionGeneration).toBe(1)
  })
})
