import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { PatchImage } from '~/types/api/patch'

globalThis.React = React

const imageViewerMock = vi.hoisted(() => ({
  openedIndex: undefined as number | undefined,
  props: undefined as
    | { preload?: number; onView?: (index: number) => void }
    | undefined
}))

const galleryPrefetchMock = vi.hoisted(() => ({
  instances: [] as Array<{
    enqueue: ReturnType<typeof vi.fn>
    prioritize: ReturnType<typeof vi.fn>
  }>
}))

vi.mock('~/components/kun/image-viewer/ImageViewer', () => ({
  KunImageViewer: ({
    children,
    ...props
  }: {
    children: (openLightbox: (index: number) => void) => React.ReactNode
    onView?: (index: number) => void
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

vi.mock('~/utils/galleryPrefetch', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('~/utils/galleryPrefetch')>()

  return {
    ...actual,
    GalleryOriginalPrefetchQueue: class {
      enqueue = vi.fn()
      prioritize = vi.fn()

      constructor() {
        galleryPrefetchMock.instances.push(this)
      }
    }
  }
})

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
    galleryPrefetchMock.instances = []
    imageViewerMock.openedIndex = undefined
    imageViewerMock.props = undefined
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('disables lightbox adjacent preload so original prefetch stays queue-owned', async () => {
    await renderGallery(createImages(2))

    expect(imageViewerMock.props?.preload).toBe(0)
  })

  it('does not enqueue every original after thumbnail previews load', async () => {
    const container = await renderGallery()
    const queue = galleryPrefetchMock.instances[0]

    await act(async () => {
      container.querySelectorAll('img').forEach((img) => {
        img.dispatchEvent(new dom!.window.Event('load'))
      })
    })

    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('prioritizes the selected gallery slot and nearby originals on open', async () => {
    const container = await renderGallery()
    const queue = galleryPrefetchMock.instances[0]
    const thirdPreview = container.querySelectorAll('img')[2]

    await act(async () => {
      thirdPreview.dispatchEvent(
        new dom!.window.MouseEvent('click', { bubbles: true })
      )
    })

    expect(queue.prioritize).toHaveBeenCalledWith([
      'https://img.example/patch/1/gallery/3.avif',
      'https://img.example/patch/1/gallery/2.avif',
      'https://img.example/patch/1/gallery/4.avif',
      'https://img.example/patch/1/gallery/1.avif',
      'https://img.example/patch/1/gallery/5.avif'
    ])
    expect(imageViewerMock.openedIndex).toBe(2)
  })

  it('prioritizes nearby originals when the lightbox view changes', async () => {
    await renderGallery()
    const queue = galleryPrefetchMock.instances[0]

    imageViewerMock.props?.onView?.(3)

    expect(queue.prioritize).toHaveBeenCalledWith([
      'https://img.example/patch/1/gallery/4.avif',
      'https://img.example/patch/1/gallery/3.avif',
      'https://img.example/patch/1/gallery/5.avif',
      'https://img.example/patch/1/gallery/2.avif'
    ])
  })
})
