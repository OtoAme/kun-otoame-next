import { describe, expect, it } from 'vitest'
import {
  getResourceAccessPolicy,
  RESOURCE_ACCESS_GRANT_MS,
  VISITOR_GAME_RESOURCE_DAILY_LIMIT,
  VISITOR_GAME_RESOURCE_WEEKLY_LIMIT
} from '~/app/api/patch/resource/download/access/policy'
import { getShanghaiQuotaWindows } from '~/app/api/patch/resource/download/access/timeWindow'

describe('visitor-first resource access policy', () => {
  it('grants a resource entry for exactly 24 hours', () => {
    expect(RESOURCE_ACCESS_GRANT_MS).toBe(24 * 60 * 60 * 1000)
  })

  it('only applies product quota to visitor galgame resources', () => {
    expect(getResourceAccessPolicy('visitor', 'galgame')).toEqual({
      productQuota: 'visitor',
      dailyLimit: VISITOR_GAME_RESOURCE_DAILY_LIMIT,
      weeklyLimit: VISITOR_GAME_RESOURCE_WEEKLY_LIMIT
    })
    expect(getResourceAccessPolicy('user', 'galgame')).toEqual({
      productQuota: 'none'
    })
    expect(getResourceAccessPolicy('visitor', 'patch')).toEqual({
      productQuota: 'none'
    })
  })

  it('uses Shanghai midnight and Monday as visitor quota boundaries', () => {
    const windows = getShanghaiQuotaWindows(
      new Date('2026-07-05T15:59:59.000Z')
    )
    expect(windows.dailyResetAt.toISOString()).toBe('2026-07-05T16:00:00.000Z')
    expect(windows.weeklyResetAt.toISOString()).toBe('2026-07-05T16:00:00.000Z')

    const newWeek = getShanghaiQuotaWindows(
      new Date('2026-07-05T16:00:00.000Z')
    )
    expect(newWeek.weeklyStart.toISOString()).toBe('2026-07-05T16:00:00.000Z')
    expect(newWeek.weeklyResetAt.toISOString()).toBe('2026-07-12T16:00:00.000Z')
  })
})
