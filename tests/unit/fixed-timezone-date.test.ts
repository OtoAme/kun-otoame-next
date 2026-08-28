import { describe, expect, it } from 'vitest'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'

describe('formatChinaDateTime', () => {
  it('formats a UTC instant in Asia/Shanghai regardless of the host timezone', () => {
    expect(formatChinaDateTime('2026-08-26T16:00:00Z')).toBe('2026/08/27 00:00')
  })

  it('accepts a Date and a timestamp as well as an ISO string', () => {
    const instant = '2026-08-27T00:00:00.000Z'

    expect(formatChinaDateTime(new Date(instant))).toBe('2026/08/27 08:00')
    expect(formatChinaDateTime(new Date(instant).getTime())).toBe(
      '2026/08/27 08:00'
    )
    expect(formatChinaDateTime(instant)).toBe('2026/08/27 08:00')
  })

  it('puts the day boundary at UTC+8, not at UTC midnight', () => {
    // 同一天的最后一分钟和下一天的第一分钟只差一秒, 却要落在不同日期上。
    expect(formatChinaDateTime('2026-08-26T15:59:59Z')).toBe('2026/08/26 23:59')
    expect(formatChinaDateTime('2026-08-26T16:00:00Z')).toBe('2026/08/27 00:00')
  })

  it('keeps the UTC+8 offset across a year boundary', () => {
    expect(formatChinaDateTime('2025-12-31T16:00:00Z')).toBe('2026/01/01 00:00')
  })
})
