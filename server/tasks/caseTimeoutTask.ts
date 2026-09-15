import cron from 'node-cron'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '~/prisma'
import { withTaskLock } from './withTaskLock'
import {
  CASE_MAX_TIMEOUT_BATCH,
  CASE_MAX_TIMEOUT_ROUNDS,
  CASE_PUBLISHER_ESCALATION_AFTER_MS,
  CASE_PUBLISHER_TIMEOUT_KINDS,
  CASE_REPORTER_TIMEOUT_AFTER_MS,
  CASE_REPORTER_TIMEOUT_KINDS,
  CASE_TIMEOUT_LOCK_KEY,
  CASE_TIMEOUT_LOCK_TTL_SECONDS
} from '~/constants/case'
import { timeoutCloseCase, upgradeCase } from '~/app/api/case/service'

export const CASE_TIMEOUT_CRON_EXPRESSION = '17 * * * *'
export const CASE_TIMEOUT_TIMEZONE = 'Asia/Shanghai'

type TimeoutDb = Pick<PrismaClient, 'ops_case'>

const loadDueReporterTimeouts = async (db: TimeoutDb, now: Date) =>
  db.ops_case.findMany({
    where: {
      owner_type: 'publisher',
      reporter_id: { not: null },
      status: 'waiting_reporter',
      kind: { in: [...CASE_REPORTER_TIMEOUT_KINDS] },
      status_changed_at: {
        lt: new Date(now.getTime() - CASE_REPORTER_TIMEOUT_AFTER_MS)
      }
    },
    orderBy: [{ status_changed_at: 'asc' }, { id: 'asc' }],
    take: CASE_MAX_TIMEOUT_BATCH,
    select: { id: true }
  })

const loadDueEscalations = async (db: TimeoutDb, now: Date) =>
  db.ops_case.findMany({
    where: {
      owner_type: 'publisher',
      status: { in: ['open', 'waiting_owner'] },
      kind: { in: [...CASE_PUBLISHER_TIMEOUT_KINDS] },
      status_changed_at: {
        lt: new Date(now.getTime() - CASE_PUBLISHER_ESCALATION_AFTER_MS)
      }
    },
    orderBy: [{ status_changed_at: 'asc' }, { id: 'asc' }],
    take: CASE_MAX_TIMEOUT_BATCH,
    select: { id: true }
  })

const runRows = async (
  rows: Array<{ id: number }>,
  action: (id: number) => Promise<unknown>
) => {
  let processed = 0
  for (const row of rows) {
    try {
      const result = await action(row.id)
      if (
        result &&
        typeof result === 'object' &&
        'changed' in result &&
        (result as { changed?: unknown }).changed === true
      ) {
        processed += 1
      }
    } catch (error) {
      console.error('[Case] Failed to process timeout row:', {
        caseId: row.id,
        error
      })
    }
  }
  return processed
}

/** Run both module 03 timeout scans once. It is safe to call manually in tests. */
export const runCaseTimeoutTask = async (
  now = new Date(),
  db: PrismaClient = prisma
) => {
  let timedOut = 0
  let escalated = 0
  for (let round = 0; round < CASE_MAX_TIMEOUT_ROUNDS; round += 1) {
    const rows = await loadDueReporterTimeouts(db, now)
    if (!rows.length) break
    timedOut += await runRows(rows, (id) => timeoutCloseCase(id, { now, db }))
    if (rows.length < CASE_MAX_TIMEOUT_BATCH) break
  }
  for (let round = 0; round < CASE_MAX_TIMEOUT_ROUNDS; round += 1) {
    const rows = await loadDueEscalations(db, now)
    if (!rows.length) break
    escalated += await runRows(rows, (id) => upgradeCase(id, { now, db }))
    if (rows.length < CASE_MAX_TIMEOUT_BATCH) break
  }
  return { timedOut, escalated }
}

export const caseTimeoutTask = cron.createTask(
  CASE_TIMEOUT_CRON_EXPRESSION,
  async () => {
    await withTaskLock(
      {
        key: CASE_TIMEOUT_LOCK_KEY,
        ttlSeconds: CASE_TIMEOUT_LOCK_TTL_SECONDS,
        taskName: 'caseTimeoutTask',
        releaseOnComplete: true
      },
      () => runCaseTimeoutTask()
    )
  },
  { timezone: CASE_TIMEOUT_TIMEZONE }
)
