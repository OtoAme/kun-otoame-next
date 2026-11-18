import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMessageSyncActivity } from '~/hooks/useMessageSyncActivity'

let root: Root
let dom: JSDOM
let current = { enabled: false, resumeVersion: 0 }
const Probe = ({ privateChat = false }: { privateChat?: boolean }) => {
  current = useMessageSyncActivity(privateChat)
  return null
}
const tick = (delay: number) => act(() => vi.advanceTimersByTimeAsync(delay))
const event = (name: string) =>
  act(() => {
    window.dispatchEvent(new dom.window.Event(name))
  })

describe('message synchronization activity', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('navigator', dom.window.navigator)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    root = createRoot(document.getElementById('root')!)
  })
  afterEach(async () => {
    await act(() => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
  it('pauses at five minutes, ignores mouse movement, and resumes on an actual activity event', async () => {
    await act(() => root.render(<Probe />))
    expect(current.enabled).toBe(true)
    await tick(299_999)
    expect(current.enabled).toBe(true)
    await event('mousemove')
    await tick(1)
    expect(current.enabled).toBe(false)
    await event('scroll')
    expect(current.enabled).toBe(true)
  })
  it('keeps foreground private chat active after five minutes without input', async () => {
    await act(() => root.render(<Probe privateChat />))
    await tick(600_000)
    expect(current.enabled).toBe(true)
  })
  it('pauses for hidden or offline pages and records a single recovery transition', async () => {
    await act(() => root.render(<Probe privateChat />))
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden'
    })
    await act(() => {
      document.dispatchEvent(new dom.window.Event('visibilitychange'))
    })
    expect(current.enabled).toBe(false)
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    })
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false
    })
    await event('offline')
    expect(current.enabled).toBe(false)
    await act(() => {
      document.dispatchEvent(new dom.window.Event('visibilitychange'))
    })
    expect(current.enabled).toBe(false)
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true
    })
    await event('online')
    expect(current.enabled).toBe(true)
  })
})
