const DEFAULT_PREFETCH_CONCURRENCY = 2

export type GalleryOriginalPrefetchStatus =
  | 'idle'
  | 'queued'
  | 'loading'
  | 'loaded'
  | 'failed'

export const getPriorityGallerySlots = (urls: string[], index: number) => {
  if (index < 0 || index >= urls.length) {
    return []
  }

  const result: string[] = []
  const seen = new Set<string>()
  const add = (slot: number) => {
    const url = urls[slot]
    if (slot >= 0 && slot < urls.length && url && !seen.has(url)) {
      seen.add(url)
      result.push(url)
    }
  }

  add(index)
  for (let offset = 1; offset <= 2; offset++) {
    add(index - offset)
    add(index + offset)
  }

  return result
}

interface GalleryOriginalPrefetchQueueOptions {
  concurrency?: number
  preload?: (url: string) => Promise<void>
}

const defaultPreload = async (url: string) => {
  if (typeof Image === 'undefined') {
    return
  }

  const image = new Image()

  if (typeof image.decode === 'function') {
    image.src = url
    await image.decode()
    return
  }

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Image preload failed'))
    image.src = url
  })
}

export class GalleryOriginalPrefetchQueue {
  private readonly concurrency: number
  private readonly preload: (url: string) => Promise<void>
  private readonly queued = new Set<string>()
  private readonly started = new Set<string>()
  private readonly status = new Map<string, GalleryOriginalPrefetchStatus>()
  private queue: string[] = []
  private active = 0

  constructor(options: GalleryOriginalPrefetchQueueOptions = {}) {
    this.concurrency = options.concurrency ?? DEFAULT_PREFETCH_CONCURRENCY
    this.preload = options.preload ?? defaultPreload
  }

  enqueue(url: string | null | undefined) {
    if (!url || this.queued.has(url) || this.started.has(url)) {
      return
    }

    this.queued.add(url)
    this.status.set(url, 'queued')
    this.queue.push(url)
    this.run()
  }

  enqueueMany(urls: string[]) {
    urls.forEach((url) => this.enqueue(url))
  }

  prioritize(urls: string[]) {
    const nextQueue = this.queue.filter((url) => !urls.includes(url))

    for (const url of [...urls].reverse()) {
      if (this.started.has(url)) {
        continue
      }

      this.queued.add(url)
      this.status.set(url, 'queued')
      nextQueue.unshift(url)
    }

    this.queue = nextQueue
    this.run()
  }

  getStatus(url: string | null | undefined): GalleryOriginalPrefetchStatus {
    if (!url) {
      return 'idle'
    }

    return this.status.get(url) ?? 'idle'
  }

  private run() {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const url = this.queue.shift()
      if (!url) {
        continue
      }

      this.queued.delete(url)
      this.started.add(url)
      this.status.set(url, 'loading')
      this.active += 1
      this.preload(url)
        .then(() => {
          this.status.set(url, 'loaded')
        })
        .catch(() => {
          this.status.set(url, 'failed')
        })
        .finally(() => {
          this.active -= 1
          this.run()
        })
    }
  }
}
