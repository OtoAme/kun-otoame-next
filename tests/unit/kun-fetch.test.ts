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

  it('returns JSON string error bodies from non-2xx responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify('发送过于频繁，请 31 秒后再试'), {
        status: 429,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const { kunFetchPost } = await import('~/utils/kunFetch')
    await expect(
      kunFetchPost<string>('/message/conversation/5', {
        type: 0,
        content: 'hello'
      })
    ).resolves.toBe('发送过于频繁，请 31 秒后再试')
  })

  it('does not log expected browser request cancellations as errors', async () => {
    const abortError = new DOMException(
      'signal is aborted without reason',
      'AbortError'
    )
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { kunFetchGet } = await import('~/utils/kunFetch')
    await expect(kunFetchGet('/message/unread')).rejects.toBe(abortError)

    expect(consoleError).not.toHaveBeenCalled()
  })

  it('preserves non-2xx status codes with string error bodies when requested', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify('图片大小不能超过 8 MB'), {
        status: 413,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { kunFetchFormData } = await import('~/utils/kunFetch')
    await expect(
      kunFetchFormData<string>(
        '/message/conversation/5/image',
        new FormData(),
        undefined,
        { preserveErrorStatus: true }
      )
    ).rejects.toThrow(
      'Kun Fetch error! Status: 413; Message: 图片大小不能超过 8 MB'
    )
  })
  it.each([
    ['90', 90_000],
    ['Thu, 01 Jan 2026 00:02:00 GMT', 120_000]
  ])('retains status, code and Retry-After %s', async (retryAfter, delay) => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ code: 'MESSAGE_RATE_LIMITED', message: 'wait' }),
            { status: 429, headers: { 'Retry-After': retryAfter } }
          )
        )
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { kunFetchGet } = await import('~/utils/kunFetch')
    await expect(
      kunFetchGet('/message/unread', undefined, {
        preserveErrorStatus: true
      })
    ).rejects.toMatchObject({
      kind: 'http',
      status: 429,
      code: 'MESSAGE_RATE_LIMITED',
      retryAfterMs: delay
    })
  })

  it('retains a structured conflict body without exposing it through enumerable errors or logs', async () => {
    const body = {
      code: 'PREFERENCE_CONFLICT',
      conflicts: ['theme'],
      snapshot: { version: 9 }
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json(body, { status: 409 }))
    )
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { kunFetchGet, KunFetchError } = await import('~/utils/kunFetch')
    const result = await kunFetchGet('/test/conflict', undefined, {
      preserveErrorStatus: true
    }).catch((error) => error)
    expect(result).toBeInstanceOf(KunFetchError)
    if (!(result instanceof KunFetchError))
      throw new Error('Expected request error')
    expect(result).toMatchObject({
      status: 409,
      code: 'PREFERENCE_CONFLICT',
      body
    })
    expect(Object.keys(result)).not.toContain('body')
    expect(JSON.stringify(result)).not.toContain('snapshot')
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('snapshot')
    expect(new KunFetchError('legacy', 'http', 409).body).toBeUndefined()
  })

  it('bounds a request even when fetch does not settle on abort', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    )
    const { kunFetchGet } = await import('~/utils/kunFetch')
    const request = expect(
      kunFetchGet('/message/unread', undefined, {
        timeout: 15_000,
        preserveErrorStatus: true
      })
    ).rejects.toMatchObject({ kind: 'timeout', status: null })
    await vi.advanceTimersByTimeAsync(15_000)
    await request
    expect(vi.getTimerCount()).toBe(0)
  })

  it('distinguishes caller cancellation and clears the timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    )
    const controller = new AbortController()
    const { kunFetchGet } = await import('~/utils/kunFetch')
    const request = expect(
      kunFetchGet('/message/unread', undefined, {
        timeout: 15_000,
        signal: controller.signal,
        preserveErrorStatus: true
      })
    ).rejects.toMatchObject({ kind: 'aborted', status: null })
    controller.abort()
    await request
    expect(vi.getTimerCount()).toBe(0)
  })

  it('classifies network failures without deriving a status from prose', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { kunFetchGet } = await import('~/utils/kunFetch')
    await expect(
      kunFetchGet('/message/unread', undefined, {
        preserveErrorStatus: true
      })
    ).rejects.toMatchObject({
      kind: 'network',
      status: null,
      retryAfterMs: null
    })
  })
  it('retains a rate-limit deadline even when its response body times out', async () => {
    const body = new ReadableStream({ start() {} })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(body, { status: 429, headers: { 'Retry-After': '180' } })
        )
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { kunFetchGet } = await import('~/utils/kunFetch')
    const request = expect(
      kunFetchGet('/message/unread', undefined, {
        timeout: 15_000,
        preserveErrorStatus: true
      })
    ).rejects.toMatchObject({
      kind: 'timeout',
      status: 429,
      retryAfterMs: 180_000
    })
    await vi.advanceTimersByTimeAsync(15_000)
    await request
  })
})
