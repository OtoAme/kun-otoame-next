import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ eval: vi.fn() }))
vi.mock('~/lib/redis', () => ({
  redis: { eval: mocks.eval },
  getPrefixedRedisKey: (key: string) => `test:${key}`,
  runRedisCommand: (command: () => Promise<unknown>) => command()
}))

import { checkCaseRateLimit } from '~/app/api/case/rateLimit'

beforeEach(() => {
  mocks.eval.mockReset().mockResolvedValue(JSON.stringify({ allowed: true }))
})
afterEach(() => vi.restoreAllMocks())

describe('case reply rate limit', () => {
  it('uses separate user and case buckets with five replies per ten minutes', async () => {
    for (const [uid, caseId] of [
      [5, 42],
      [5, 43],
      [6, 42]
    ]) {
      await expect(
        checkCaseRateLimit('message', uid, caseId)
      ).resolves.toBeNull()
      expect(mocks.eval).toHaveBeenLastCalledWith(
        expect.any(String),
        1,
        `test:case:rate-limit:message:${uid}:${caseId}`,
        '600',
        '5'
      )
    }
  })

  it('returns the remaining wait when the reply quota is exhausted', async () => {
    mocks.eval.mockResolvedValue(
      JSON.stringify({ allowed: false, retryAfterMs: 1001 })
    )
    await expect(checkCaseRateLimit('message', 5, 42)).resolves.toBe(
      '回复过于频繁，请 2 秒后再试'
    )
  })

  it('allows replies during a Redis failure while still refusing image storage', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.eval.mockRejectedValue(new Error('Redis unavailable'))
    await expect(checkCaseRateLimit('message', 5, 42)).resolves.toBeNull()
    await expect(checkCaseRateLimit('image-upload', 5)).resolves.toBe(
      '服务暂时不可用，请稍后重试'
    )
  })
})
