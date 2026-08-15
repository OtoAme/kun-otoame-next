import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'

globalThis.React = React

vi.mock('@heroui/react', () => ({
  Image: ({
    removeWrapper: _removeWrapper,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & {
    removeWrapper?: boolean
  }) => <img {...props} />
}))

describe('StickerThumbnail', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined
  let intersectionCallbacks: Map<string, IntersectionObserverCallback>
  let playMock: ReturnType<typeof vi.fn>
  let pauseMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('navigator', dom.window.navigator)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    intersectionCallbacks = new Map()
    playMock = vi.fn(() => Promise.resolve())
    pauseMock = vi.fn()
    Object.defineProperty(dom.window.HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: playMock
    })
    Object.defineProperty(dom.window.HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      value: pauseMock
    })
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        readonly root = null
        readonly rootMargin: string
        readonly thresholds = [0]

        constructor(
          callback: IntersectionObserverCallback,
          options?: IntersectionObserverInit
        ) {
          this.rootMargin = options?.rootMargin ?? '0px'
          intersectionCallbacks.set(this.rootMargin, callback)
        }

        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return []
        }
      }
    )
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    intersectionCallbacks.clear()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('keeps a loaded WebM mounted while pausing it offscreen and resuming it in place', async () => {
    const { StickerThumbnail } = await import(
      '~/components/sticker/StickerThumbnail'
    )
    const container = dom!.window.document.getElementById('root')!
    root = createRoot(container)

    await act(async () => {
      root!.render(
        <StickerThumbnail
          src="https://cdn.example.com/wave.webm"
          posterSrc="https://cdn.example.com/wave.webp"
          mediaType="video"
          mime="video/webm"
          alt="挥手"
        />
      )
    })

    expect(container.querySelector('video')).toBeNull()

    await act(async () => {
      intersectionCallbacks.get('160px')?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        { disconnect: vi.fn() } as unknown as IntersectionObserver
      )
    })

    await act(async () => {
      intersectionCallbacks.get('0px')?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        { disconnect: vi.fn() } as unknown as IntersectionObserver
      )
    })

    const video = container.querySelector<HTMLVideoElement>('video')!
    expect(video).not.toBeNull()
    expect(video.preload).toBe('auto')

    await act(async () => {
      video.dispatchEvent(
        new dom!.window.Event('loadeddata', { bubbles: true })
      )
    })
    video.currentTime = 0.75
    pauseMock.mockClear()

    await act(async () => {
      intersectionCallbacks.get('0px')?.(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        { disconnect: vi.fn() } as unknown as IntersectionObserver
      )
    })

    expect(container.querySelector('video')).toBe(video)
    expect(video.currentTime).toBe(0.75)
    expect(pauseMock).toHaveBeenCalledTimes(1)
    playMock.mockClear()

    await act(async () => {
      intersectionCallbacks.get('0px')?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        { disconnect: vi.fn() } as unknown as IntersectionObserver
      )
    })

    expect(container.querySelector('video')).toBe(video)
    expect(video.currentTime).toBe(0.75)
    expect(playMock).toHaveBeenCalledTimes(1)
  })

  it('recovers a visible WebM after the browser pauses or stalls it', async () => {
    const { StickerThumbnail } = await import(
      '~/components/sticker/StickerThumbnail'
    )
    const container = dom!.window.document.getElementById('root')!
    root = createRoot(container)

    await act(async () => {
      root!.render(
        <StickerThumbnail
          src="https://cdn.example.com/wave.webm"
          posterSrc="https://cdn.example.com/wave.webp"
          mediaType="video"
          mime="video/webm"
          alt="挥手"
        />
      )
    })
    await act(async () => {
      intersectionCallbacks.get('160px')?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        { disconnect: vi.fn() } as unknown as IntersectionObserver
      )
      intersectionCallbacks.get('0px')?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        { disconnect: vi.fn() } as unknown as IntersectionObserver
      )
    })

    const video = container.querySelector<HTMLVideoElement>('video')!
    playMock.mockClear()

    await act(async () => {
      video.dispatchEvent(new dom!.window.Event('pause', { bubbles: true }))
      video.dispatchEvent(new dom!.window.Event('stalled', { bubbles: true }))
    })

    expect(playMock).toHaveBeenCalledTimes(2)
  })
})
