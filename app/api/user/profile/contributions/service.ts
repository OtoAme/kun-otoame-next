import type { Prisma } from '@prisma/client'
import type { Activity } from 'react-activity-calendar'
import { prisma } from '~/prisma/index'
import {
  formatShanghaiCalendarDate,
  shiftCalendarDate
} from '~/utils/moemoepointDateRange'
import { getProfileResourceWhere } from '../resource/where'

const contributionRange = (year: number | undefined) => {
  if (year !== undefined) {
    return { firstDay: `${year}-01-01`, lastDay: `${year}-12-31` }
  }
  const today = formatShanghaiCalendarDate(new Date())
  const previousYear = Number(today.slice(0, 4)) - 1
  // A February 29 anniversary falls on February 28 in the previous year.
  const monthDay = today.endsWith('02-29') ? '02-28' : today.slice(5)
  return {
    firstDay: shiftCalendarDate(`${previousYear}-${monthDay}`, 1),
    lastDay: today
  }
}

export const getProfileContributions = async (
  uid: number,
  year: number | undefined,
  visibility: Prisma.patchWhereInput
): Promise<Activity[]> => {
  const { firstDay, lastDay } = contributionRange(year)
  const where = {
    user_id: uid,
    created: {
      gte: new Date(`${firstDay}T00:00:00+08:00`),
      lt: new Date(`${shiftCalendarDate(lastDay, 1)}T00:00:00+08:00`)
    }
  }
  const select = { created: true }
  const sources = await Promise.all([
    prisma.patch_resource.findMany({
      where: { ...where, ...getProfileResourceWhere(visibility) },
      select
    }),
    prisma.patch.findMany({ where: { ...where, ...visibility }, select }),
    prisma.patch_comment.findMany({ where, select }),
    prisma.patch_rating.findMany({ where, select })
  ])

  // The calendar uses the first and last dates to determine its full range.
  const counts = new Map([
    [firstDay, 0],
    [lastDay, 0]
  ])
  for (const rows of sources) {
    for (const { created } of rows) {
      const day = formatShanghaiCalendarDate(created)
      counts.set(day, (counts.get(day) ?? 0) + 1)
    }
  }
  return Array.from(counts, ([date, count]) => ({
    date,
    count,
    level: [1, 2, 4, 8].filter((threshold) => count >= threshold).length
  })).sort((a, b) => a.date.localeCompare(b.date))
}
