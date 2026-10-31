import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  set: vi.fn(),
  executeRaw: vi.fn()
}))
vi.mock('~/lib/redis', () => ({
  redis: { set: mocks.set },
  getPrefixedRedisKey: (key: string) => `test:${key}`
}))
vi.mock('~/prisma/index', () => ({
  prisma: { $executeRaw: mocks.executeRaw }
}))

import { recordDailyActive } from '~/app/api/user/active/service'

describe('recordDailyActive', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.executeRaw.mockResolvedValue(1)
  })

  it('writes the first visit of a Shanghai day and keys it by that day', async () => {
    mocks.set.mockResolvedValue('OK')
    // 2026-10-31 23:30 UTC is already 11-01 in Shanghai.
    await recordDailyActive(7, new Date('2026-10-31T16:30:00Z'))
    expect(mocks.set).toHaveBeenCalledWith(
      'test:user:active:2026-11-01:7',
      '1',
      'EX',
      86400,
      'NX'
    )
    const [sql, ...values] = mocks.executeRaw.mock.calls[0]
    expect(sql.join('?')).toContain('ON CONFLICT DO NOTHING')
    expect(values).toEqual(['2026-11-01', 7])
  })

  it('skips the database once the day is already marked', async () => {
    mocks.set.mockResolvedValue(null)
    await recordDailyActive(7)
    expect(mocks.executeRaw).not.toHaveBeenCalled()
  })

  it('never fails the session when Redis or the database is down', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.set.mockRejectedValue(new Error('redis down'))
    await expect(recordDailyActive(7)).resolves.toBeUndefined()
    mocks.set.mockResolvedValue('OK')
    mocks.executeRaw.mockRejectedValue(new Error('db down'))
    await expect(recordDailyActive(7)).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledTimes(2)
    error.mockRestore()
  })
})
