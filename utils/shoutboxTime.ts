import { SHOUTBOX_RETENTION_MONTHS } from '~/constants/shoutbox'

const SHANGHAI_OFFSET_MINUTES = 8 * 60

/**
 * Adds calendar months in Asia/Shanghai while preserving the local clock.
 * JavaScript's Date month overflow is avoided by clamping to the last day of
 * the target month before constructing the UTC instant.
 */
export const addShoutboxRetentionMonths = (created: Date, months: number) => {
  if (!Number.isInteger(months)) {
    throw new Error('月份必须为整数')
  }

  const shanghai = new Date(
    created.getTime() + SHANGHAI_OFFSET_MINUTES * 60_000
  )
  const year = shanghai.getUTCFullYear()
  const month = shanghai.getUTCMonth()
  const day = shanghai.getUTCDate()
  const hour = shanghai.getUTCHours()
  const minute = shanghai.getUTCMinutes()
  const second = shanghai.getUTCSeconds()
  const millisecond = shanghai.getUTCMilliseconds()

  const targetMonthIndex = month + months
  const targetYear = year + Math.floor(targetMonthIndex / 12)
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0)
  ).getUTCDate()
  const targetDay = Math.min(day, lastDay)

  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      targetDay,
      hour,
      minute,
      second,
      millisecond
    ) -
      SHANGHAI_OFFSET_MINUTES * 60_000
  )
}

export const getShoutboxExpiry = (created: Date) =>
  addShoutboxRetentionMonths(created, SHOUTBOX_RETENTION_MONTHS)

export const isShoutboxWithinRetention = (created: Date, now: Date) =>
  getShoutboxExpiry(created).getTime() > now.getTime()

export const isShoutboxEffective = (
  effectiveFrom: Date | null,
  effectiveTo: Date | null,
  now: Date
) =>
  effectiveFrom !== null &&
  effectiveTo !== null &&
  effectiveFrom.getTime() <= now.getTime() &&
  now.getTime() < effectiveTo.getTime()
