import { describe, expect, it, vi } from 'vitest'
import {
  GalleryOriginalPrefetchQueue,
  getPriorityGallerySlots
} from '~/utils/galleryPrefetch'

describe('gallery original prefetch', () => {
  it('preloads originals through Image.decode and records loaded status', async () => {
    const previousImage = globalThis.Image
    const decoded: string[] = []

    class MockImage {
      src = ''
      decode = vi.fn().mockImplementation(async () => {
        decoded.push(this.src)
      })
    }

    ;(globalThis as any).Image = MockImage

    const queue = new GalleryOriginalPrefetchQueue()
    queue.enqueue('/gallery/original.avif')

    await vi.waitFor(() => {
      expect(decoded).toEqual(['/gallery/original.avif'])
      expect(queue.getStatus('/gallery/original.avif')).toBe('loaded')
    })

    ;(globalThis as any).Image = previousImage
  })

  it('records failed status when Image.decode rejects', async () => {
    const previousImage = globalThis.Image

    class MockImage {
      src = ''
      decode = vi.fn().mockRejectedValue(new Error('decode failed'))
    }

    ;(globalThis as any).Image = MockImage

    const queue = new GalleryOriginalPrefetchQueue()
    queue.enqueue('/gallery/broken.avif')

    await vi.waitFor(() => {
      expect(queue.getStatus('/gallery/broken.avif')).toBe('failed')
    })

    ;(globalThis as any).Image = previousImage
  })

  it('falls back to onload when Image.decode is unavailable', async () => {
    const previousImage = globalThis.Image
    const loaded: string[] = []

    class MockImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      private value = ''

      set src(url: string) {
        this.value = url
        setImmediate(() => {
          loaded.push(this.value)
          this.onload?.()
        })
      }

      get src() {
        return this.value
      }
    }

    ;(globalThis as any).Image = MockImage

    const queue = new GalleryOriginalPrefetchQueue()
    queue.enqueue('/gallery/fallback.avif')

    await vi.waitFor(() => {
      expect(loaded).toEqual(['/gallery/fallback.avif'])
      expect(queue.getStatus('/gallery/fallback.avif')).toBe('loaded')
    })

    ;(globalThis as any).Image = previousImage
  })

  it('prioritizes current gallery slot and nearby slots without using filename numbering', () => {
    const urls = [
      '/gallery/100.avif',
      '/gallery/20.avif',
      '/gallery/3.avif',
      '/gallery/400.avif',
      '/gallery/5.avif',
      '/gallery/60.avif'
    ]

    expect(getPriorityGallerySlots(urls, 2)).toEqual([
      '/gallery/3.avif',
      '/gallery/20.avif',
      '/gallery/400.avif',
      '/gallery/100.avif',
      '/gallery/5.avif'
    ])
  })

  it('runs original preloads with bounded concurrency and priority promotion', async () => {
    const pending: Array<() => void> = []
    const started: string[] = []
    const queue = new GalleryOriginalPrefetchQueue({
      concurrency: 2,
      preload: (url) => {
        started.push(url)
        return new Promise<void>((resolve) => pending.push(resolve))
      }
    })

    queue.enqueue('/gallery/1.avif')
    queue.enqueue('/gallery/2.avif')
    queue.enqueue('/gallery/3.avif')
    queue.prioritize(['/gallery/4.avif', '/gallery/3.avif'])

    expect(started).toEqual(['/gallery/1.avif', '/gallery/2.avif'])

    pending.shift()?.()
    await vi.waitFor(() => {
      expect(started).toEqual([
        '/gallery/1.avif',
        '/gallery/2.avif',
        '/gallery/4.avif'
      ])
    })

    pending.shift()?.()
    await vi.waitFor(() => {
      expect(started).toEqual([
        '/gallery/1.avif',
        '/gallery/2.avif',
        '/gallery/4.avif',
        '/gallery/3.avif'
      ])
    })
  })
})
