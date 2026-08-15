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
  let intersectionCallback: IntersectionObserverCallback | undefined

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('navigator', dom.window.navigator)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        readonly root = null
        readonly rootMargin = '160px'
        readonly thresholds = [0]

        constructor(callback: IntersectionObserverCallback) {
          intersectionCallback = callback
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
    intersectionCallback = undefined
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('keeps a loaded WebM mounted when it leaves and re-enters the viewport', async () => {
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
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        { disconnect: vi.fn() } as unknown as IntersectionObserver
      )
    })

    const video = container.querySelector<HTMLVideoElement>('video')!
    expect(video).not.toBeNull()

    await act(async () => {
      video.dispatchEvent(
        new dom!.window.Event('loadeddata', { bubbles: true })
      )
    })
    video.currentTime = 0.75

    await act(async () => {
      intersectionCallback?.(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        { disconnect: vi.fn() } as unknown as IntersectionObserver
      )
    })

    expect(container.querySelector('video')).toBe(video)
    expect(video.currentTime).toBe(0.75)

    await act(async () => {
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        { disconnect: vi.fn() } as unknown as IntersectionObserver
      )
    })

    expect(container.querySelector('video')).toBe(video)
    expect(video.currentTime).toBe(0.75)
  })
})
