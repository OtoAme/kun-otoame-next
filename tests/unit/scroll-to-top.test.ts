import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'

describe('kunScrollToTop', () => {
  let dom: JSDOM | undefined

  const setupWindow = () => {
    dom = new JSDOM('<!doctype html><main></main>', {
      url: 'http://localhost'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('performance', dom.window.performance)

    return dom.window
  }

  afterEach(() => {
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('jumps directly when the user prefers reduced motion', async () => {
    const win = setupWindow()
    const scrollTo = vi.fn()
    Object.defineProperty(win, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true })
    })
    Object.defineProperty(win, 'scrollTo', {
      configurable: true,
      value: scrollTo
    })
    Object.defineProperty(win, 'requestAnimationFrame', {
      configurable: true,
      value: vi.fn()
    })

    const { kunScrollToTop } = await import('~/utils/scrollToTop')

    kunScrollToTop()

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
    expect(win.requestAnimationFrame).not.toHaveBeenCalled()
  })

  it('uses the fast shared animation duration by default', async () => {
    const win = setupWindow()
    const frames: FrameRequestCallback[] = []
    const scrollTo = vi.fn()
    Object.defineProperty(win, 'scrollY', {
      configurable: true,
      value: 600
    })
    Object.defineProperty(win, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false })
    })
    Object.defineProperty(win, 'scrollTo', {
      configurable: true,
      value: scrollTo
    })
    Object.defineProperty(win, 'requestAnimationFrame', {
      configurable: true,
      value: vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback)
        return frames.length
      })
    })
    Object.defineProperty(win, 'cancelAnimationFrame', {
      configurable: true,
      value: vi.fn()
    })

    const { KUN_FAST_SCROLL_TO_TOP_DURATION_MS, kunScrollToTop } = await import(
      '~/utils/scrollToTop'
    )

    expect(KUN_FAST_SCROLL_TO_TOP_DURATION_MS).toBeLessThanOrEqual(220)

    kunScrollToTop()

    expect(frames).toHaveLength(1)
    frames.shift()?.(0)
    frames.shift()?.(KUN_FAST_SCROLL_TO_TOP_DURATION_MS)

    expect(scrollTo).toHaveBeenLastCalledWith({
      top: 0,
      left: 0,
      behavior: 'auto'
    })
  })
})
