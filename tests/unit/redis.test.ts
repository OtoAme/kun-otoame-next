import { describe, it, expect, vi, beforeEach } from 'vitest'

// Use vi.hoisted to create mocks that can be referenced inside vi.mock
const redisMocks = vi.hoisted(() => {
  return {
    get: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
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

import { getOrSet } from '~/lib/redis'

describe('getOrSet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    expect(redisMocks.setex).toHaveBeenCalledWith(expect.stringContaining(key), 10, JSON.stringify(data))
  })

  it('should handle concurrent requests by calling fetcher only once', async () => {
    const key = 'test-key-concurrent'
    const data = { foo: 'bar' }
    redisMocks.get.mockResolvedValue(null)

    // Delayed fetcher to simulate slow DB
    const fetcher = vi.fn().mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
      return data
    })

    const promises = Array(200).fill(null).map(() => getOrSet(key, fetcher, 10))
    const results = await Promise.all(promises)

    expect(fetcher).toHaveBeenCalledTimes(1)
    results.forEach(res => expect(res).toEqual(data))
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
