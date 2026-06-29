import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'

globalThis.React = React

const lightboxMock = vi.hoisted(() => ({
  offset: 0,
  renderedSlide: undefined as React.ReactNode,
  renderedSlideContainer: undefined as React.ReactNode
}))

vi.mock('yet-another-react-lightbox', () => ({
  default: ({
    render,
    slides
  }: {
    render: {
      slide?: (props: {
        slide: unknown
        offset: number
        rect: { width: number; height: number }
      }) => React.ReactNode
      slideContainer?: (props: {
        slide: unknown
        children: React.ReactNode
      }) => React.ReactNode
    }
    slides: unknown[]
  }) => {
    const slideProps = {
      slide: slides[0],
      offset: lightboxMock.offset,
      rect: { width: 800, height: 600 }
    }
    lightboxMock.renderedSlide = render.slide?.(slideProps)

    const defaultSlide = (
      <img
        src={(slides[0] as { src: string }).src}
        alt={(slides[0] as { alt?: string }).alt ?? ''}
        data-testid="default-lightbox-image"
      />
    )
    lightboxMock.renderedSlideContainer =
      render.slideContainer?.({
        slide: slides[0],
        children: defaultSlide
      }) ?? defaultSlide

    return (
      <div data-testid="lightbox">{lightboxMock.renderedSlideContainer}</div>
    )
  }
}))

describe('KunImageViewer', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const renderViewer = async () => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { KunImageViewer } = await import(
      '~/components/kun/image-viewer/ImageViewer'
    )
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    const rerender = async () => {
      root!.render(
        <KunImageViewer
          images={[
            {
              src: 'https://img.example/original.avif',
              previewSrc: 'https://img.example/thumb.avif',
              alt: 'gallery'
            }
          ]}
        >
          {() => null}
        </KunImageViewer>
      )
    }

    await act(async () => {
      await rerender()
    })

    return { container: container!, rerender }
  }

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    lightboxMock.offset = 0
    lightboxMock.renderedSlide = undefined
    lightboxMock.renderedSlideContainer = undefined
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('does not override default image slide rendering so zoom can measure the original image', async () => {
    await renderViewer()

    expect(lightboxMock.renderedSlide).toBeUndefined()
    expect(lightboxMock.renderedSlideContainer).toBeTruthy()
  })

  it('renders the preview and default original image for offscreen progressive slides so lightbox preload can work', async () => {
    lightboxMock.offset = 1

    const { container } = await renderViewer()
    const srcs = Array.from(container.querySelectorAll('img')).map((img) =>
      img.getAttribute('src')
    )

    expect(srcs).toEqual([
      'https://img.example/thumb.avif',
      'https://img.example/original.avif'
    ])
  })

  it('renders the original image for the current progressive slide', async () => {
    const { container } = await renderViewer()
    const srcs = Array.from(container.querySelectorAll('img')).map((img) =>
      img.getAttribute('src')
    )

    expect(srcs).toContain('https://img.example/original.avif')
  })

  it('keeps the original image mounted while the current slide moves offscreen during navigation', async () => {
    const { container, rerender } = await renderViewer()
    const original = container.querySelector(
      'img[src="https://img.example/original.avif"]'
    )
    expect(original).not.toBeNull()

    await act(async () => {
      original!.dispatchEvent(new dom!.window.Event('load', { bubbles: true }))
    })

    lightboxMock.offset = 1
    await act(async () => {
      await rerender()
    })

    const srcs = Array.from(container.querySelectorAll('img')).map((img) =>
      img.getAttribute('src')
    )

    expect(srcs).toContain('https://img.example/original.avif')
  })
})
