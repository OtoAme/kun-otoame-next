import { prisma } from '~/prisma/index'
import { redis, getPrefixedRedisKey } from '~/lib/redis'
import { formatShanghaiCalendarDate } from '~/utils/moemoepointDateRange'

const DAY_SECONDS = 24 * 60 * 60

/**
 * Records that the user was active on today's Shanghai calendar day. The
 * session is refreshed on every page load, so a Redis marker lets only the
 * first visit of the day reach the database; the insert itself ignores a
 * duplicate, so a lost marker costs one extra no-op write, never a double
 * count. Failures are logged and swallowed: activity stats must never break
 * the session. If the insert fails after the marker is set, that user's day
 * goes unrecorded; the marker stays so a failing database is not retried on
 * every page load.
 */
export const recordDailyActive = async (uid: number, now = new Date()) => {
  const day = formatShanghaiCalendarDate(now)
  try {
    const marker = await redis.set(
      getPrefixedRedisKey(`user:active:${day}:${uid}`),
      '1',
      'EX',
      DAY_SECONDS,
      'NX'
    )
    if (marker === null) return
    await prisma.$executeRaw`
      INSERT INTO user_daily_active (day, user_id)
      VALUES (${day}::date, ${uid})
      ON CONFLICT DO NOTHING
    `
  } catch (error) {
    console.error('Failed to record daily activity', { uid, day, error })
  }
}
