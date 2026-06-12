import { beforeEach, describe, expect, it, vi } from 'vitest'

const redisMocks = vi.hoisted(() => ({
  delKvPattern: vi.fn(),
  getKv: vi.fn(),
  setKv: vi.fn()
}))

vi.mock('~/lib/redis', () => redisMocks)

import {
  getCachedAnonymousJsonResponse,
  invalidateAnonymousApiResponseCaches
} from '~/app/api/utils/anonymousApiResponseCache'

const request = (url: string, cookie = '') =>
  ({
    url,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'cookie' ? cookie : null)
    }
  }) as Request

describe('anonymous API response cache', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    redisMocks.delKvPattern.mockResolvedValue(undefined)
    redisMocks.getKv.mockResolvedValue(null)
    redisMocks.setKv.mockResolvedValue(undefined)
    await invalidateAnonymousApiResponseCaches()
    vi.clearAllMocks()
    redisMocks.delKvPattern.mockResolvedValue(undefined)
    redisMocks.getKv.mockResolvedValue(null)
    redisMocks.setKv.mockResolvedValue(undefined)
  })

  it('reuses cached anonymous JSON without calling the producer', async () => {
    redisMocks.getKv.mockResolvedValueOnce('{"ok":true}')
    const producer = vi.fn()

    const response = await getCachedAnonymousJsonResponse(
      request('https://example.test/api/tag/otomegame?sortOrder=desc&tagId=15'),
      'tag_otomegame',
      producer
    )

    expect(producer).not.toHaveBeenCalled()
    expect(await response.text()).toBe('{"ok":true}')
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('cache-control')).toBe(
      'public, s-maxage=30, stale-while-revalidate=300'
    )
    expect(response.headers.get('x-kun-cache')).toBe('redis')
  })

  it('stores anonymous JSON responses with a stable query cache key', async () => {
    const producer = vi.fn().mockResolvedValue({ ok: true })

    const response = await getCachedAnonymousJsonResponse(
      request('https://example.test/api/tag/otomegame?tagId=15&sortOrder=desc'),
      'tag_otomegame',
      producer
    )

    expect(await response.text()).toBe('{"ok":true}')
    expect(redisMocks.setKv).toHaveBeenCalledWith(
      'anonymous_api:tag_otomegame:sortOrder=desc&tagId=15',
      '{"ok":true}',
      30
    )
  })

  it('serves repeated anonymous requests from memory without Redis reads', async () => {
    const producer = vi.fn().mockResolvedValue({ ok: true })
    const req = request(
      'https://example.test/api/tag/otomegame?tagId=15&sortOrder=desc'
    )

    await getCachedAnonymousJsonResponse(req, 'tag_otomegame', producer)
    const response = await getCachedAnonymousJsonResponse(
      req,
      'tag_otomegame',
      producer
    )

    expect(await response.text()).toBe('{"ok":true}')
    expect(response.headers.get('x-kun-cache')).toBe('memory')
    expect(producer).toHaveBeenCalledTimes(1)
    expect(redisMocks.getKv).toHaveBeenCalledTimes(1)
    expect(redisMocks.setKv).toHaveBeenCalledTimes(1)
  })

  it('reuses memory cache for equivalent query strings with different order', async () => {
    const producer = vi.fn().mockResolvedValue({ ok: true })

    await getCachedAnonymousJsonResponse(
      request('https://example.test/api/tag/otomegame?tagId=15&sortOrder=desc'),
      'tag_otomegame',
      producer
    )
    const response = await getCachedAnonymousJsonResponse(
      request('https://example.test/api/tag/otomegame?sortOrder=desc&tagId=15'),
      'tag_otomegame',
      producer
    )

    expect(await response.text()).toBe('{"ok":true}')
    expect(response.headers.get('x-kun-cache')).toBe('memory')
    expect(producer).toHaveBeenCalledTimes(1)
    expect(redisMocks.getKv).toHaveBeenCalledTimes(1)
    expect(redisMocks.setKv).toHaveBeenCalledTimes(1)
  })

  it('coalesces concurrent anonymous memory misses', async () => {
    redisMocks.getKv.mockResolvedValue(null)
    const producer = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return { ok: true }
    })
    const req = request('https://example.test/api/tag/otomegame?tagId=15')

    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        getCachedAnonymousJsonResponse(req, 'tag_otomegame', producer)
      )
    )

    expect(await responses[0].text()).toBe('{"ok":true}')
    expect(responses[0].headers.get('x-kun-cache')).toBe('miss')
    expect(responses[1].headers.get('x-kun-cache')).toBe('pending')
    expect(producer).toHaveBeenCalledTimes(1)
    expect(redisMocks.getKv).toHaveBeenCalledTimes(1)
    expect(redisMocks.setKv).toHaveBeenCalledTimes(1)
  })

  it('shares Redis cache across equivalent query strings with different order', async () => {
    redisMocks.getKv.mockResolvedValueOnce('{"ok":true}')
    const producer = vi.fn()

    const response = await getCachedAnonymousJsonResponse(
      request('https://example.test/api/tag/otomegame?sortOrder=desc&tagId=15'),
      'tag_otomegame',
      producer
    )

    expect(await response.text()).toBe('{"ok":true}')
    expect(redisMocks.getKv).toHaveBeenCalledWith(
      'anonymous_api:tag_otomegame:sortOrder=desc&tagId=15'
    )
    expect(producer).not.toHaveBeenCalled()
  })

  it('does not store personalized requests', async () => {
    const producer = vi.fn().mockResolvedValue({ ok: true })

    const response = await getCachedAnonymousJsonResponse(
      request(
        'https://example.test/api/tag/otomegame?tagId=15',
        'kun-galgame-patch-moe-token=token'
      ),
      'tag_otomegame',
      producer
    )

    expect(await response.text()).toBe('{"ok":true}')
    expect(response.headers.get('x-kun-cache')).toBe('private')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(redisMocks.getKv).not.toHaveBeenCalled()
    expect(redisMocks.setKv).not.toHaveBeenCalled()
  })

  it('falls back to the producer when Redis read or write fails', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    redisMocks.getKv.mockRejectedValueOnce(new Error('Redis get failed'))
    redisMocks.setKv.mockRejectedValueOnce(new Error('Redis set failed'))
    const producer = vi.fn().mockResolvedValue({ ok: true })

    const readErrorResponse = await getCachedAnonymousJsonResponse(
      request('https://example.test/api/tag/otomegame?tagId=15'),
      'tag_otomegame',
      producer
    )

    const writeErrorResponse = await getCachedAnonymousJsonResponse(
      request('https://example.test/api/tag/otomegame?tagId=16'),
      'tag_otomegame',
      producer
    )

    expect(await readErrorResponse.text()).toBe('{"ok":true}')
    expect(await writeErrorResponse.text()).toBe('{"ok":true}')
    expect(producer).toHaveBeenCalledTimes(2)
    consoleErrorSpy.mockRestore()
  })

  it('invalidates all anonymous API response caches', async () => {
    await invalidateAnonymousApiResponseCaches()

    expect(redisMocks.delKvPattern).toHaveBeenCalledWith('anonymous_api:*')
  })
})
