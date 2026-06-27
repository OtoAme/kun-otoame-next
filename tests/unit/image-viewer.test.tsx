import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'

globalThis.React = React

const lightboxMock = vi.hoisted(() => ({
  offset: 0
}))

vi.mock('yet-another-react-lightbox', () => ({
  default: ({
    render,
    slides
  }: {
    render: {
      slide: (props: {
        slide: unknown
        offset: number
        rect: { width: number; height: number }
      }) => React.ReactNode
    }
    slides: unknown[]
  }) => (
    <div data-testid="lightbox">
      {render.slide({
        slide: slides[0],
        offset: lightboxMock.offset,
        rect: { width: 800, height: 600 }
      })}
    </div>
  )
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
    await act(async () => {
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
    })

    return container!
  }

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    lightboxMock.offset = 0
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('does not render the original image for offscreen progressive slides', async () => {
    lightboxMock.offset = 1

    const container = await renderViewer()
    const srcs = Array.from(container.querySelectorAll('img')).map((img) =>
      img.getAttribute('src')
    )

    expect(srcs).toEqual(['https://img.example/thumb.avif'])
  })

  it('renders the original image for the current progressive slide', async () => {
    const container = await renderViewer()
    const srcs = Array.from(container.querySelectorAll('img')).map((img) =>
      img.getAttribute('src')
    )

    expect(srcs).toContain('https://img.example/original.avif')
  })
})
