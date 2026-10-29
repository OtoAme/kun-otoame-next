import { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import type { StatsTrendData, StatsTrendPoint } from '~/types/api/admin'

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** Shanghai calendar date (YYYY-MM-DD) of an instant. */
const shanghaiDate = (time: Date) =>
  new Date(time.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10)

type DayCount = { day: string; count: bigint | number }

const countByDay = (
  table: 'user' | 'patch' | 'patch_resource' | 'patch_comment',
  since: Date
) =>
  prisma.$queryRaw<DayCount[]>(Prisma.sql`
    SELECT to_char(("created" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS day,
           COUNT(*) AS count
    FROM ${Prisma.raw(`"${table}"`)}
    WHERE "created" >= ${since}
    GROUP BY day
  `)

/**
 * Daily new records for the last `days` Shanghai calendar days, today
 * included. Every day appears, zero-filled. Login activity has no per-day
 * history (only the last login time is stored), so it is not in the series.
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

  const [users, games, resources, comments] = await Promise.all([
    countByDay('user', since),
    countByDay('patch', since),
    countByDay('patch_resource', since),
    countByDay('patch_comment', since)
  ])
  const index = (rows: DayCount[]) =>
    new Map(rows.map((row) => [row.day, Number(row.count)]))
  const [u, g, r, c] = [users, games, resources, comments].map(index)

  const points: StatsTrendPoint[] = []
  for (let i = 0; i < days; i++) {
    const date = new Date(firstDay.getTime() + i * DAY_MS)
      .toISOString()
      .slice(0, 10)
    points.push({
      date,
      newUser: u.get(date) ?? 0,
      newGalgame: g.get(date) ?? 0,
      newGalgameResource: r.get(date) ?? 0,
      newComment: c.get(date) ?? 0
    })
  }
  return { days, points }
}
