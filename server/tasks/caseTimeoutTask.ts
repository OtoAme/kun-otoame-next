import cron from 'node-cron'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '~/prisma'
import { withTaskLock } from './withTaskLock'
import {
  CASE_MAX_TIMEOUT_BATCH,
  CASE_MAX_TIMEOUT_ROUNDS,
  CASE_PUBLISHER_ESCALATION_AFTER_MS,
  CASE_PUBLISHER_TIMEOUT_KINDS,
  CASE_REMINDER_LEAD_MS,
  CASE_REPORTER_TIMEOUT_AFTER_MS,
  CASE_REPORTER_TIMEOUT_KINDS,
  CASE_TIMEOUT_LOCK_KEY,
  CASE_TIMEOUT_LOCK_TTL_SECONDS
} from '~/constants/case'
import {
  remindCase,
  timeoutCloseCase,
  upgradeCase
} from '~/app/api/case/service'

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

/**
 * Scan three (D22): cases inside the last 48 hours before either deadline that
 * have not been reminded on their current revision. `reminded_revision` only
 * ever takes the current revision and revisions only grow, so "below the
 * current revision" is the same as "not reminded this round"; the field
 * reference keeps reminded rounds out of the batch, so the loop cannot spin.
 */
const loadDueReminders = async (db: TimeoutDb, now: Date) => {
  const notReminded = {
    OR: [
      { reminded_revision: null },
      { reminded_revision: { lt: db.ops_case.fields.revision } }
    ]
  }
  return db.ops_case.findMany({
    where: {
      owner_type: 'publisher',
      OR: [
        {
          status: { in: ['open', 'waiting_owner'] },
          kind: { in: [...CASE_PUBLISHER_TIMEOUT_KINDS] },
          status_changed_at: {
            lt: new Date(
              now.getTime() -
                CASE_PUBLISHER_ESCALATION_AFTER_MS +
                CASE_REMINDER_LEAD_MS
            ),
            gte: new Date(now.getTime() - CASE_PUBLISHER_ESCALATION_AFTER_MS)
          }
        },
        {
          status: 'waiting_reporter',
          reporter_id: { not: null },
          kind: { in: [...CASE_REPORTER_TIMEOUT_KINDS] },
          status_changed_at: {
            lt: new Date(
              now.getTime() -
                CASE_REPORTER_TIMEOUT_AFTER_MS +
                CASE_REMINDER_LEAD_MS
            ),
            gte: new Date(now.getTime() - CASE_REPORTER_TIMEOUT_AFTER_MS)
          }
        }
      ],
      AND: [notReminded]
    },
    orderBy: [{ status_changed_at: 'asc' }, { id: 'asc' }],
    take: CASE_MAX_TIMEOUT_BATCH,
    select: { id: true }
  })
}

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

/** Run the module 03 timeout and reminder scans once. Safe to call manually in tests. */
export const runCaseTimeoutTask = async (
  now = new Date(),
  db: PrismaClient = prisma
) => {
  let timedOut = 0
  let escalated = 0
  let reminded = 0
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
  for (let round = 0; round < CASE_MAX_TIMEOUT_ROUNDS; round += 1) {
    const rows = await loadDueReminders(db, now)
    if (!rows.length) break
    reminded += await runRows(rows, (id) => remindCase(id, { now, db }))
    if (rows.length < CASE_MAX_TIMEOUT_BATCH) break
  }
  return { timedOut, escalated, reminded }
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
