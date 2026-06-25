import { describe, expect, it, vi } from 'vitest'
import {
  GalleryOriginalPrefetchQueue,
  getPriorityGallerySlots
} from '~/utils/galleryPrefetch'

describe('gallery original prefetch', () => {
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
