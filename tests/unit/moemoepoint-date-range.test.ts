import { describe, expect, it } from 'vitest'
import { moemoepointLedgerQuerySchema } from '~/validations/moemoepoint'
import {
  getMoemoepointRangeDays,
  resolveMoemoepointDateRange
} from '~/utils/moemoepointDateRange'

describe('moemoepoint date ranges', () => {
  it('uses inclusive Shanghai calendar days for presets', () => {
    const range = resolveMoemoepointDateRange(
      { range: '7d' },
      new Date('2026-08-17T16:30:00.000Z')
    )

    expect(range.start).toBe('2026-08-12')
    expect(range.end).toBe('2026-08-18')
    expect(range.startAt.toISOString()).toBe('2026-08-11T16:00:00.000Z')
    expect(range.endAtExclusive.toISOString()).toBe('2026-08-18T16:00:00.000Z')
  })

  it('accepts an inclusive 90-day custom range', () => {
    expect(getMoemoepointRangeDays('2026-01-01', '2026-03-31')).toBe(90)
    expect(
      moemoepointLedgerQuerySchema.safeParse({
        range: 'custom',
        start: '2026-01-01',
        end: '2026-03-31'
      }).success
    ).toBe(true)
  })

  it('rejects invalid, reversed, incomplete, and 91-day custom ranges', () => {
    for (const input of [
      { range: 'custom', start: '2026-02-30', end: '2026-03-01' },
      { range: 'custom', start: '2026-03-02', end: '2026-03-01' },
      { range: 'custom', start: '2026-01-01' },
      { range: 'custom', start: '2026-01-01', end: '2026-04-01' }
    ]) {
      expect(moemoepointLedgerQuerySchema.safeParse(input).success).toBe(false)
    }
  })
})
