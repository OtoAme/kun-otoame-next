import { beforeEach, describe, expect, it, vi } from 'vitest'

const redisMocks = vi.hoisted(() => ({
  eval: vi.fn()
}))

vi.mock('~/lib/redis', () => ({
  getPrefixedRedisKey: (key: string) => `kun:touchgal:${key}`,
  redis: redisMocks,
  runRedisCommand: <T>(command: () => Promise<T>) => command()
}))

import { checkResourceAccessActionRateLimit } from '~/app/api/patch/resource/download/access/rateLimit'

const visitorActor = {
  actorType: 'visitor' as const,
  uid: 0 as const,
  visitorToken: '123e4567-e89b-42d3-a456-426614174000',
  ipHash: 'hashed-ip-address',
  shouldSetVisitorCookie: false as const
}

describe('resource access action rate limit', () => {
  beforeEach(() => {
    redisMocks.eval.mockReset()
    redisMocks.eval.mockResolvedValue(
      JSON.stringify({ allowed: true, remaining: 29 })
    )
  })

  it('uses exactly one technical rate-limit key for a request', async () => {
    await checkResourceAccessActionRateLimit(visitorActor)

    expect(redisMocks.eval).toHaveBeenCalledWith(
      expect.stringContaining('resource access action rate limit'),
      1,
      expect.stringContaining('resource-access:rate-limit:v1:visitor-token:'),
      '60',
      '30'
    )
    expect(redisMocks.eval).toHaveBeenCalledTimes(1)
    expect(redisMocks.eval.mock.calls[0][1]).toBe(1)
  })

  it('uses an IP key only before a visitor cookie is established', async () => {
    await checkResourceAccessActionRateLimit({
      ...visitorActor,
      shouldSetVisitorCookie: true,
      visitorToken: 'new-visitor-token'
    })

    expect(redisMocks.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      expect.stringContaining('resource-access:rate-limit:v1:visitor-ip:'),
      '60',
      '30'
    )
  })

  it('fails open only for the technical limiter when Redis is unavailable', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    redisMocks.eval.mockRejectedValueOnce(new Error('redis unavailable'))

    await expect(
      checkResourceAccessActionRateLimit(visitorActor)
    ).resolves.toEqual({ allowed: true })
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to check resource access action rate limit',
      expect.objectContaining({ actorType: 'visitor' })
    )
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      visitorActor.visitorToken
    )
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      visitorActor.ipHash
    )
    consoleError.mockRestore()
  })
})
