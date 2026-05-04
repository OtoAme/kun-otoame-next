import { describe, it, expect, vi, beforeEach } from 'vitest'

// Use vi.hoisted to create mocks that can be referenced inside vi.mock
const redisMocks = vi.hoisted(() => {
  return {
    get: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    scan: vi.fn(),
    eval: vi.fn()
  }
})

// Mock ioredis to return our hoisted mocks
vi.mock('ioredis', () => {
  return {
    default: class Redis {
      constructor() {
        return redisMocks
      }
    }
  }
})

import { delKvPattern, getOrSet } from '~/lib/redis'

describe('getOrSet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    redisMocks.set.mockResolvedValue('OK')
    redisMocks.setex.mockResolvedValue('OK')
    redisMocks.eval.mockResolvedValue(1)
  })

  it('should return cached data if available', async () => {
    const key = 'test-key'
    const data = { foo: 'bar' }
    redisMocks.get.mockResolvedValue(JSON.stringify(data))
    const fetcher = vi.fn()

    const result = await getOrSet(key, fetcher, 10)

    expect(result).toEqual(data)
    expect(redisMocks.get).toHaveBeenCalledWith(expect.stringContaining(key))
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('should call fetcher and set cache if no cache available', async () => {
    const key = 'test-key-miss'
    const data = { foo: 'bar' }
    redisMocks.get.mockResolvedValue(null)
    const fetcher = vi.fn().mockResolvedValue(data)

    const result = await getOrSet(key, fetcher, 10)

    expect(result).toEqual(data)
    expect(redisMocks.get).toHaveBeenCalledWith(expect.stringContaining(key))
    expect(fetcher).toHaveBeenCalled()
    expect(redisMocks.setex).toHaveBeenCalledWith(
      expect.stringContaining(key),
      expect.any(Number),
      expect.stringContaining('"__kunCacheVersion":1')
    )
  })

  it('should handle concurrent requests by calling fetcher only once', async () => {
    const key = 'test-key-concurrent'
    const data = { foo: 'bar' }
    redisMocks.get.mockResolvedValue(null)

    // Delayed fetcher to simulate slow DB
    const fetcher = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return data
    })

    const promises = Array(200)
      .fill(null)
      .map(() => getOrSet(key, fetcher, 10))
    const results = await Promise.all(promises)

    expect(fetcher).toHaveBeenCalledTimes(1)
    results.forEach((res) => expect(res).toEqual(data))
  })

  it('should handle Redis get error gracefully', async () => {
    const key = 'test-key-error'
    const data = { foo: 'bar' }
    redisMocks.get.mockRejectedValue(new Error('Redis error'))
    const fetcher = vi.fn().mockResolvedValue(data)

    const result = await getOrSet(key, fetcher, 10)

    expect(result).toEqual(data)
    expect(fetcher).toHaveBeenCalled()
  })

  it('should handle Redis set error gracefully', async () => {
    const key = 'test-key-set-error'
    const data = { foo: 'bar' }
    redisMocks.get.mockResolvedValue(null)
    redisMocks.setex.mockRejectedValue(new Error('Redis set error'))
    const fetcher = vi.fn().mockResolvedValue(data)

    const result = await getOrSet(key, fetcher, 10)

    expect(result).toEqual(data)
    expect(fetcher).toHaveBeenCalled()
  })
})

describe('delKvPattern', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should delete matched keys across scan pages', async () => {
    redisMocks.scan
      .mockResolvedValueOnce(['1', ['kun:touchgal:home_data:a']])
      .mockResolvedValueOnce([
        '0',
        ['kun:touchgal:home_data:b', 'kun:touchgal:home_data:c']
      ])

    await delKvPattern('home_data:*')

    expect(redisMocks.scan).toHaveBeenNthCalledWith(
      1,
      '0',
      'MATCH',
      'kun:touchgal:home_data:*',
      'COUNT',
      100
    )
    expect(redisMocks.scan).toHaveBeenNthCalledWith(
      2,
      '1',
      'MATCH',
      'kun:touchgal:home_data:*',
      'COUNT',
      100
    )
    expect(redisMocks.del).toHaveBeenNthCalledWith(
      1,
      'kun:touchgal:home_data:a'
    )
    expect(redisMocks.del).toHaveBeenNthCalledWith(
      2,
      'kun:touchgal:home_data:b',
      'kun:touchgal:home_data:c'
    )
  })
})
