import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: { $queryRaw: vi.fn(), user: { count: vi.fn() } }
}))
vi.mock('~/prisma/index', () => ({ prisma: mocks.prisma }))

import { getStatsTrend } from '~/app/api/admin/stats/trend/service'

const sqlOf = (call: unknown[]) =>
  (call[0] as { text?: string; sql?: string }).text ??
  (call[0] as { sql: string }).sql

describe('admin stats trend', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.prisma.user.count.mockResolvedValue(4)
    mocks.prisma.$queryRaw.mockResolvedValue([])
  })

  it('zero-fills every Shanghai day of the window, today included', async () => {
    // 2026-10-29 01:00 in Shanghai is still 10-28 in UTC.
    const now = new Date('2026-10-28T17:00:00Z')
    mocks.prisma.$queryRaw.mockImplementation((sql: { values: unknown[] }) =>
      Promise.resolve(
        sqlOf([sql]).includes('"patch_comment"')
          ? [{ day: '2026-10-29', count: BigInt(3) }]
          : []
      )
    )
    const result = await getStatsTrend(3, now)
    expect(result.points.map((point) => point.date)).toEqual([
      '2026-10-27',
      '2026-10-28',
      '2026-10-29'
    ])
    expect(result.points.map((point) => point.newComment)).toEqual([0, 0, 3])
    expect(result.points.every((point) => point.newUser === 0)).toBe(true)
    expect(result.recentLogin).toBe(4)
  })

  it('starts the window at Shanghai midnight of the first day', async () => {
    await getStatsTrend(7, new Date('2026-10-29T04:00:00Z'))
    // First day 10-23 00:00 Shanghai = 10-22 16:00 UTC.
    const since = new Date('2026-10-22T16:00:00Z')
    for (const call of mocks.prisma.$queryRaw.mock.calls) {
      const values = (call[0] as { values: unknown[] }).values
      // The per-day login record is keyed by calendar date, not an instant.
      if (sqlOf(call).includes('user_daily_active')) {
        expect(values).toContain('2026-10-23')
      } else {
        expect(values).toContainEqual(since)
      }
    }
    expect(mocks.prisma.user.count).toHaveBeenCalledWith({
      where: { last_login_time: { gte: since.getTime().toString() } }
    })
  })

  it('reads daily logins from the per-day record by calendar date', async () => {
    mocks.prisma.$queryRaw.mockImplementation((sql: { values: unknown[] }) =>
      Promise.resolve(
        sqlOf([sql]).includes('user_daily_active')
          ? [{ day: '2026-10-29', count: BigInt(4) }]
          : []
      )
    )
    const result = await getStatsTrend(3, new Date('2026-10-28T17:00:00Z'))
    const logins = mocks.prisma.$queryRaw.mock.calls.find((call) =>
      sqlOf(call).includes('user_daily_active')
    )!
    // The day column is already a Shanghai date: compared as a date, no
    // time-zone conversion.
    expect(sqlOf(logins)).not.toContain('AT TIME ZONE')
    expect((logins[0] as { values: unknown[] }).values).toContain('2026-10-27')
    expect(result.points.map((point) => point.dailyLogin)).toEqual([0, 0, 4])
  })

  it('counts check-ins from the reward ledger only', async () => {
    await getStatsTrend(1)
    const ledger = mocks.prisma.$queryRaw.mock.calls.find((call) =>
      sqlOf(call).includes('"user_moemoepoint_ledger"')
    )!
    expect(sqlOf(ledger)).toContain('"reason_code" =')
    expect((ledger[0] as { values: unknown[] }).values).toContain(
      'check_in.reward'
    )
  })
})
