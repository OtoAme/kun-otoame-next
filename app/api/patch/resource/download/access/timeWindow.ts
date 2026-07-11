const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

const shanghaiUtc = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day) - SHANGHAI_OFFSET_MS)

export const getShanghaiQuotaWindows = (now: Date) => {
  const shanghai = new Date(now.getTime() + SHANGHAI_OFFSET_MS)
  const day = shanghai.getUTCDay()
  const sinceMonday = day === 0 ? 6 : day - 1
  const dailyStart = shanghaiUtc(
    shanghai.getUTCFullYear(),
    shanghai.getUTCMonth(),
    shanghai.getUTCDate()
  )
  const weeklyStart = shanghaiUtc(
    shanghai.getUTCFullYear(),
    shanghai.getUTCMonth(),
    shanghai.getUTCDate() - sinceMonday
  )

  return {
    dailyStart,
    weeklyStart,
    dailyResetAt: new Date(dailyStart.getTime() + 24 * 60 * 60 * 1000),
    weeklyResetAt: new Date(weeklyStart.getTime() + 7 * 24 * 60 * 60 * 1000)
  }
}
