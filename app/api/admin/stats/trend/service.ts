import { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import { MOEMOEPOINT_REASON } from '~/constants/moemoepoint'
import type {
  StatsTrendData,
  StatsTrendMetric,
  StatsTrendPoint
} from '~/types/api/admin'

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** Shanghai calendar date (YYYY-MM-DD) of an instant. */
const shanghaiDate = (time: Date) =>
  new Date(time.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10)

type DayCount = { day: string; count: bigint | number }

/**
 * Daily series: each counts the rows of one table created on that Shanghai
 * day. Every one is a record the site already keeps for its own purpose.
 */
const SERIES: Record<
  Exclude<StatsTrendMetric, 'dailyLogin'>,
  { table: string; where?: Prisma.Sql }
> = {
  newUser: { table: 'user' },
  newGalgame: { table: 'patch' },
  newGalgameResource: { table: 'patch_resource' },
  newComment: { table: 'patch_comment' },
  newRating: { table: 'patch_rating' },
  newSubmission: { table: 'patch_submission' },
  newCase: { table: 'ops_case' },
  resourceAccess: { table: 'patch_resource_access' },
  checkIn: {
    table: 'user_moemoepoint_ledger',
    where: Prisma.sql`AND "reason_code" = ${MOEMOEPOINT_REASON.checkIn.code}`
  }
}

const countByDay = (
  metric: Exclude<StatsTrendMetric, 'dailyLogin'>,
  since: Date
) => {
  const { table, where } = SERIES[metric]
  return prisma.$queryRaw<DayCount[]>(Prisma.sql`
    SELECT to_char(("created" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS day,
           COUNT(*) AS count
    FROM ${Prisma.raw(`"${table}"`)}
    WHERE "created" >= ${since} ${where ?? Prisma.empty}
    GROUP BY day
  `)
}

/**
 * Users active on each day, from the one-row-per-user-per-day record. The
 * day column is already a Shanghai calendar date, so no conversion here.
 * Days before recording began simply have no rows and count as zero.
 */
const countDailyLogins = (firstDay: string) =>
  prisma.$queryRaw<DayCount[]>(Prisma.sql`
    SELECT to_char(day, 'YYYY-MM-DD') AS day, COUNT(*) AS count
    FROM user_daily_active
    WHERE day >= ${firstDay}::date
    GROUP BY day
  `)

/**
 * Daily counts for the last `days` Shanghai calendar days, today included,
 * every day zero-filled. `recentLogin` stays the window's distinct users by
 * last login time; `dailyLogin` is the per-day series, available only from
 * the day the daily record started.
 */
export const getStatsTrend = async (
  days: number,
  now = new Date()
): Promise<StatsTrendData> => {
  const today = shanghaiDate(now)
  const firstDay = new Date(
    Date.parse(`${today}T00:00:00Z`) - (days - 1) * DAY_MS
  )
  // Shanghai midnight of the first day, as an instant.
  const since = new Date(firstDay.getTime() - SHANGHAI_OFFSET_MS)

  const metrics = Object.keys(SERIES) as Exclude<
    StatsTrendMetric,
    'dailyLogin'
  >[]
  const firstDate = firstDay.toISOString().slice(0, 10)
  const [recentLogin, logins, ...series] = await Promise.all([
    prisma.user.count({
      where: { last_login_time: { gte: since.getTime().toString() } }
    }),
    countDailyLogins(firstDate),
    ...metrics.map((metric) => countByDay(metric, since))
  ])
  const index = (rows: DayCount[]) =>
    new Map(rows.map((row) => [row.day, Number(row.count)]))
  const byMetric = new Map<StatsTrendMetric, Map<string, number>>([
    ['dailyLogin', index(logins)],
    ...metrics.map(
      (metric, i) =>
        [metric, index(series[i])] as [StatsTrendMetric, Map<string, number>]
    )
  ])

  const points: StatsTrendPoint[] = []
  for (let i = 0; i < days; i++) {
    const date = new Date(firstDay.getTime() + i * DAY_MS)
      .toISOString()
      .slice(0, 10)
    const point = { date } as StatsTrendPoint
    for (const [metric, counts] of byMetric) {
      point[metric] = counts.get(date) ?? 0
    }
    points.push(point)
  }
  return { days, recentLogin, points }
}
