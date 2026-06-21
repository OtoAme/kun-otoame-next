import { afterEach, describe, expect, it, vi } from 'vitest'

describe('kunFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    vi.useRealTimers()
  })

  it('rejects timed requests with an actionable timeout message', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, options?: RequestInit) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => {
              reject(options.signal?.reason)
            })
          })
      )
    )

    const { kunFetchFormData } = await import('~/utils/kunFetch')
    const request = kunFetchFormData('/edit', new FormData(), 1000)
    const rejection = expect(request).rejects.toThrow('请求超时，请稍后重试')

    await vi.advanceTimersByTimeAsync(1000)

    await rejection
  })
})
