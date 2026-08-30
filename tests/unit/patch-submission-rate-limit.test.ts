import { beforeEach, describe, expect, it, vi } from 'vitest'

const redisMocks = vi.hoisted(() => ({
  eval: vi.fn(),
  runRedisCommand: vi.fn((command: () => Promise<unknown>) => command())
}))
vi.mock('~/lib/redis', () => ({
  redis: { eval: redisMocks.eval },
  runRedisCommand: redisMocks.runRedisCommand,
  getPrefixedRedisKey: (key: string) => `test:${key}`
}))

import { checkPatchSubmissionRateLimit } from '~/app/api/patch-submission/rateLimit'

describe('patch submission external fetch rate limit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('uses a 30 request / 10 minute policy', async () => {
    redisMocks.eval.mockResolvedValue(JSON.stringify({ allowed: true }))

    await expect(
      checkPatchSubmissionRateLimit('external-fetch', 7)
    ).resolves.toBeNull()
    expect(redisMocks.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'test:patch-submission:rate-limit:external-fetch:7',
      '600',
      '30'
    )
  })

  it('fails open when Redis is unavailable', async () => {
    redisMocks.eval.mockRejectedValue(new Error('redis down'))

    await expect(
      checkPatchSubmissionRateLimit('external-fetch', 7)
    ).resolves.toBeNull()
  })
})
