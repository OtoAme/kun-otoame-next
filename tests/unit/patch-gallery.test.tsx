import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { PatchImage } from '~/types/api/patch'

globalThis.React = React

const imageViewerMock = vi.hoisted(() => ({
  openedIndex: undefined as number | undefined,
  props: undefined as { preload?: number } | undefined
}))

vi.mock('~/components/kun/image-viewer/ImageViewer', () => ({
  KunImageViewer: ({
    children,
    ...props
  }: {
    children: (openLightbox: (index: number) => void) => React.ReactNode
    preload?: number
  }) => {
    imageViewerMock.props = props
    return (
      <div>
        {children((index: number) => {
          imageViewerMock.openedIndex = index
        })}
      </div>
    )
  }
}))

vi.mock('~/components/kun/NSFWMask', () => ({
  NSFWMask: () => null
}))

const createImages = (count: number): PatchImage[] =>
  Array.from({ length: count }, (_, index) => {
    const id = index + 1

    return {
      id,
      url: `https://img.example/patch/1/gallery/${id}.avif`,
      thumbnailUrl: `https://img.example/patch/1/gallery/thumbnail/${id}.avif`,
      isNSFW: false
    }
  })

describe('Patch gallery', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const renderGallery = async (images: PatchImage[] = createImages(5)) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { Gallery } = await import('~/components/patch/gallery/Gallery')
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(<Gallery images={images} />)
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
    imageViewerMock.openedIndex = undefined
    imageViewerMock.props = undefined
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('keeps one adjacent lightbox slide so lightbox owns original preloading', async () => {
    await renderGallery(createImages(2))

    expect(imageViewerMock.props?.preload).toBe(1)
  })

  it('does not wire thumbnail loads to a manual original preload queue', async () => {
    const container = await renderGallery()

    await act(async () => {
      container.querySelectorAll('img').forEach((img) => {
        img.dispatchEvent(new dom!.window.Event('load'))
      })
    })

    expect(imageViewerMock.openedIndex).toBeUndefined()
  })

  it('opens the selected gallery slot', async () => {
    const container = await renderGallery()
    const thirdPreview = container.querySelectorAll('img')[2]

    await act(async () => {
      thirdPreview.dispatchEvent(
        new dom!.window.MouseEvent('click', { bubbles: true })
      )
    })

    expect(imageViewerMock.openedIndex).toBe(2)
  })
})
