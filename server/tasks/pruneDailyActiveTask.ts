import cron from 'node-cron'
import { prisma } from '~/prisma'
import { formatShanghaiCalendarDate } from '~/utils/moemoepointDateRange'
import { withTaskLock } from './withTaskLock'

/**
 * user_daily_active only feeds the overview trend, whose widest window is 60
 * days; 90 keeps a margin for a wider window later. Older rows are dropped
 * twice a month, so between runs the table holds at most about 105 days,
 * which still covers every window the overview can ask for.
 */
export const DAILY_ACTIVE_RETENTION_DAYS = 90

const LOCK_KEY = 'cron:prune-daily-active:lock'
const LOCK_TTL_SECONDS = 60 * 60
const TIMEZONE = 'Asia/Shanghai'
// Small batches keep each delete short so it never holds locks for long.
const BATCH_SIZE = 5000
const MAX_BATCHES = 200
const DAY_MS = 24 * 60 * 60 * 1000

/** First Shanghai calendar day that is kept (YYYY-MM-DD). */
export const dailyActiveCutoff = (now = new Date()) =>
  formatShanghaiCalendarDate(
    new Date(now.getTime() - (DAILY_ACTIVE_RETENTION_DAYS - 1) * DAY_MS)
  )

/**
 * Deletes rows older than the retention window, oldest first, in bounded
 * batches. Returns how many rows went. Stops early when a batch comes back
 * short; anything left past the batch cap goes on the next run.
 */
export const pruneDailyActive = async (now = new Date()) => {
  const cutoff = dailyActiveCutoff(now)
  let removed = 0
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const count = await prisma.$executeRaw`
      DELETE FROM user_daily_active
      WHERE (day, user_id) IN (
        SELECT day, user_id FROM user_daily_active
        WHERE day < ${cutoff}::date
        ORDER BY day
        LIMIT ${BATCH_SIZE}
      )
    `
    removed += count
    if (count < BATCH_SIZE) break
  }
  return removed
}

export const pruneDailyActiveTask = cron.createTask(
  // 04:30 on the 1st and the 15th: node-cron has no "every 14 days", and a
  // fixed day of month keeps the schedule independent of restarts.
  '30 4 1,15 * *',
  async () => {
    await withTaskLock(
      {
        key: LOCK_KEY,
        ttlSeconds: LOCK_TTL_SECONDS,
        taskName: 'pruneDailyActiveTask'
      },
      async () => {
        const removed = await pruneDailyActive()
        if (removed > 0) {
          console.info('Pruned daily activity rows', { removed })
        }
      }
    ).catch((error) => {
      console.error('Error pruning daily activity:', error)
    })
  },
  { timezone: TIMEZONE, noOverlap: true }
)
