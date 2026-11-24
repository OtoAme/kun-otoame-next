import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import {
  isNotificationBodyVisible,
  observeNotificationReading
} from '~/utils/notificationVisibility'

let dom: JSDOM
let body: HTMLElement
let visible: string
let focused: boolean
let hit: Element | null
let bounds: DOMRect

beforeEach(() => {
  vi.useFakeTimers()
  dom = new JSDOM('<main><p>合成通知完整正文</p></main>', {
    pretendToBeVisual: true
  })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('getComputedStyle', dom.window.getComputedStyle)
  vi.stubGlobal('performance', { now: () => Date.now() })
  body = document.querySelector('p')!
  visible = 'visible'
  focused = true
  hit = body
  bounds = {
    top: 30,
    left: 20,
    width: 300,
    height: 100,
    right: 320,
    bottom: 130
  } as DOMRect
  vi.spyOn(body, 'getBoundingClientRect').mockImplementation(() => bounds)
  Object.defineProperty(document, 'visibilityState', {
    get: () => visible,
    configurable: true
  })
  document.hasFocus = () => focused
  document.elementFromPoint = () => hit
})

afterEach(() => {
  dom.window.close()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('notification actual reading visibility', () => {
  it('requires a continuous foreground focused second and stops after confirmation', () => {
    const read = vi.fn()
    const stop = observeNotificationReading(body, read)
    vi.advanceTimersByTime(900)
    expect(read).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(read).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(3000)
    expect(read).toHaveBeenCalledTimes(1)
    stop()
  })

  it('resets elapsed time for a quick pass, scrolling, blur and background transitions', () => {
    const read = vi.fn()
    const stop = observeNotificationReading(body, read)
    vi.advanceTimersByTime(900)
    window.dispatchEvent(new dom.window.Event('scroll'))
    vi.advanceTimersByTime(900)
    focused = false
    window.dispatchEvent(new dom.window.Event('blur'))
    vi.advanceTimersByTime(2000)
    focused = true
    visible = 'hidden'
    vi.advanceTimersByTime(2000)
    visible = 'visible'
    document.dispatchEvent(new dom.window.Event('visibilitychange'))
    vi.advanceTimersByTime(1000)
    expect(read).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(read).toHaveBeenCalledTimes(1)
    stop()
  })

  it('rejects an overlay, a mostly offscreen body and hidden or detached content', () => {
    expect(isNotificationBodyVisible(body)).toBe(true)
    hit = document.querySelector('main')
    expect(isNotificationBodyVisible(body)).toBe(false)
    hit = body
    bounds = { ...bounds, top: -90, bottom: 10 } as DOMRect
    expect(isNotificationBodyVisible(body)).toBe(false)
    bounds = { ...bounds, top: 30, bottom: 130 } as DOMRect
    body.style.visibility = 'hidden'
    expect(isNotificationBodyVisible(body)).toBe(false)
    body.style.visibility = 'visible'
    body.remove()
    expect(isNotificationBodyVisible(body)).toBe(false)
  })

  it('does not carry time across an obstruction or produce a request after disposal', () => {
    const read = vi.fn()
    const stop = observeNotificationReading(body, read)
    vi.advanceTimersByTime(900)
    hit = document.querySelector('main')
    vi.advanceTimersByTime(100)
    hit = body
    vi.advanceTimersByTime(1000)
    expect(read).not.toHaveBeenCalled()
    stop()
    vi.advanceTimersByTime(1000)
    expect(read).not.toHaveBeenCalled()
  })

  it('rejects transparent or hidden ancestors even when hit testing reaches the body', () => {
    const parent = body.parentElement!
    parent.style.opacity = '0'
    expect(isNotificationBodyVisible(body)).toBe(false)
    parent.style.opacity = '1'
    parent.style.contentVisibility = 'hidden'
    expect(isNotificationBodyVisible(body)).toBe(false)
    parent.style.contentVisibility = 'visible'
    expect(isNotificationBodyVisible(body)).toBe(true)
  })
})
