export type MoemoepointRangePreset = '7d' | '30d' | 'custom'

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
export const MAX_MOEMOEPOINT_CUSTOM_RANGE_DAYS = 90

const parseDateParts = (value: string) => {
  const match = DATE_PATTERN.exec(value)
  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return { year, month, day, utcTime: date.getTime() }
}

export const isValidMoemoepointDate = (value: string) =>
  parseDateParts(value) !== null

const formatUtcDate = (time: number) =>
  new Date(time).toISOString().slice(0, 10)

export const formatShanghaiCalendarDate = (date: Date) =>
  formatUtcDate(date.getTime() + SHANGHAI_OFFSET_MS)

const shiftCalendarDate = (value: string, days: number) => {
  const parsed = parseDateParts(value)
  if (!parsed) {
    throw new Error('日期格式不正确')
  }
  return formatUtcDate(parsed.utcTime + days * 24 * 60 * 60 * 1000)
}

export const getMoemoepointRangeDays = (start: string, end: string) => {
  const parsedStart = parseDateParts(start)
  const parsedEnd = parseDateParts(end)
  if (!parsedStart || !parsedEnd) {
    return null
  }
  return Math.floor((parsedEnd.utcTime - parsedStart.utcTime) / 86400000) + 1
}

export const resolveMoemoepointDateRange = (
  input: {
    range: MoemoepointRangePreset
    start?: string
    end?: string
  },
  now = new Date()
) => {
  const today = formatShanghaiCalendarDate(now)
  const end = input.range === 'custom' ? input.end! : today
  const start =
    input.range === 'custom'
      ? input.start!
      : shiftCalendarDate(today, input.range === '7d' ? -6 : -29)

  return {
    preset: input.range,
    start,
    end,
    startAt: new Date(`${start}T00:00:00+08:00`),
    endAtExclusive: new Date(`${shiftCalendarDate(end, 1)}T00:00:00+08:00`)
  }
}
