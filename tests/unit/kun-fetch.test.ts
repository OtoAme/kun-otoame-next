import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('kunFetchGet', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_KUN_PATCH_ADDRESS_DEV', 'http://localhost:3000')
    vi.stubGlobal('window', undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('aborts a GET request when the timeout elapses', async () => {
    let signal: AbortSignal | null | undefined
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new Error('aborted'))
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { kunFetchGet } = await import('~/utils/kunFetch')
    const request = kunFetchGet('/message/unread', undefined, { timeout: 10 })
    const requestError = expect(request).rejects.toThrow()

    await vi.advanceTimersByTimeAsync(10)

    await requestError
    expect(signal?.aborted).toBe(true)
  })
})
