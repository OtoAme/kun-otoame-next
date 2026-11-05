import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HANDOVER_MESSAGES } from '~/app/api/patch/resource/mutation'

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
  patch_resource: { findUnique: vi.fn() },
  ops_case: { findUnique: vi.fn(), updateMany: vi.fn() },
  ops_case_message: { create: vi.fn() },
  user: { findMany: vi.fn() },
  user_message: { createMany: vi.fn() }
}))
vi.mock('~/prisma/index', () => ({ prisma: db }))
vi.mock('~/prisma', () => ({ prisma: db }))
vi.mock('~/lib/redis', () => ({
  delKv: vi.fn(),
  delKvPattern: vi.fn(),
  delKvs: vi.fn(),
  getKv: vi.fn(),
  getKvs: vi.fn(),
  setKv: vi.fn()
}))
vi.mock('~/app/api/patch/cache', () => ({
  invalidatePatchContentCache: vi.fn(),
  invalidatePatchListCaches: vi.fn()
}))

import { representedPublisherLinkCaseIds } from '~/app/api/patch/resource/maintenance/read'
import {
  reopenCase,
  transferPublisherCasesOnHandover
} from '~/app/api/case/service'

const now = new Date('2026-11-04T00:00:00.000Z')
const closedRow = {
  id: 1,
  kind: 'resource_mismatch',
  target_type: 'resource',
  target_id: 10,
  patch_id: 20,
  owner_type: 'publisher',
  owner_id: 7,
  status: 'resolved',
  resolution: 'fixed',
  public: false,
  source: 'report',
  dedup_key: 'resource:10:resource_mismatch:4',
  daily_key: null,
  revision: 2,
  status_changed_at: new Date('2026-11-03T00:00:00.000Z'),
  queue_entered_at: new Date('2026-11-01T00:00:00.000Z'),
  closed_at: new Date('2026-11-03T12:00:00.000Z'),
  escalated_at: null,
  first_owner_response_at: new Date('2026-11-02T00:00:00.000Z'),
  hidden_at: null,
  restored_at: null,
  reopened_count: 0,
  reminded_revision: 0,
  reporter_id: 4,
  created: new Date('2026-11-01T00:00:00.000Z'),
  updated: new Date('2026-11-03T12:00:00.000Z')
}

beforeEach(() => {
  vi.clearAllMocks()
  db.$transaction.mockImplementation(async (callback) => callback(db))
  db.$queryRaw.mockImplementation(async (query) => {
    const sql = String(query?.sql ?? '')
    if (sql.includes('FOR KEY SHARE')) return [{ id: 4 }, { id: 9 }]
    if (sql.includes('FOR UPDATE')) return [{ id: 1 }]
    return []
  })
  db.ops_case_message.create.mockResolvedValue({ id: 1 })
  db.user.findMany.mockResolvedValue([{ id: 9 }])
  db.user_message.createMany.mockResolvedValue({ count: 1 })
  db.patch_resource.findUnique.mockImplementation(async (args) => {
    if (args?.select?.publisher_left_at) {
      return { publisher_left_at: new Date('2026-10-01T00:00:00.000Z') }
    }
    if (args?.select?.name) return { name: 'card' }
    return null
  })
})

describe('official mirror handover cases', () => {
  it('moves unresolved publisher cases to staff without restoring the old owner', async () => {
    const changedAt = new Date('2026-10-02T00:00:00.000Z')
    db.$queryRaw.mockResolvedValue([
      {
        id: 3,
        status: 'waiting_reporter',
        revision: 2,
        status_changed_at: changedAt
      },
      {
        id: 4,
        status: 'open',
        revision: 1,
        status_changed_at: changedAt
      }
    ])
    db.ops_case.updateMany.mockResolvedValue({ count: 1 })
    await transferPublisherCasesOnHandover(db as never, 10, now)
    const waiting = db.ops_case.updateMany.mock.calls[0][0]
    const opened = db.ops_case.updateMany.mock.calls[1][0]
    expect(waiting.where).toMatchObject({
      id: 3,
      status: 'waiting_reporter',
      owner_type: 'publisher'
    })
    expect(waiting.data.owner_type).toBe('staff')
    expect(waiting.data.owner_id).toBeNull()
    expect(waiting.data).not.toHaveProperty('status')
    expect(waiting.data).not.toHaveProperty('status_changed_at')
    expect(opened.data).toMatchObject({
      owner_type: 'staff',
      owner_id: null,
      status: 'open',
      status_changed_at: now
    })
    for (const call of db.ops_case_message.create.mock.calls) {
      const payload = call[0].data.payload
      expect(payload.escalation_trigger).toBe('publisher_left')
      expect(payload.from_status).toEqual(expect.any(String))
      expect(payload).not.toHaveProperty('from_owner_type')
      expect(payload).not.toHaveProperty('from_owner_id')
      expect(call[0].data.body).toBe(
        '发布者已交由站方维护，问题改由网站管理员处理。'
      )
    }
    expect(db.ops_case_message.create.mock.calls[0][0].data.payload).toMatchObject({
      from_status: 'waiting_reporter',
      to_status: 'waiting_reporter'
    })
    expect(db.ops_case_message.create.mock.calls[1][0].data.payload).toMatchObject({
      from_status: 'open',
      to_status: 'open'
    })
  })

  it('conflicts when a locked case no longer matches and writes no later message', async () => {
    db.$queryRaw.mockResolvedValue([
      {
        id: 3,
        status: 'waiting_reporter',
        revision: 2,
        status_changed_at: now
      },
      { id: 4, status: 'open', revision: 1, status_changed_at: now }
    ])
    db.ops_case.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
    await expect(
      transferPublisherCasesOnHandover(db as never, 10, now)
    ).rejects.toThrow(HANDOVER_MESSAGES.caseConflict)
    expect(db.ops_case_message.create).toHaveBeenCalledTimes(1)
  })

  it('opens onto staff when handover sets left before the resource lock returns', async () => {
    // left stays null until the resource row lock runs. A read taken before
    // that lock is the stale snapshot from before handover committed.
    let resourceLocked = false
    let fullReads = 0
    db.$queryRaw.mockImplementation(async (query) => {
      const sql = String(query?.sql ?? '')
      if (sql.includes('FOR KEY SHARE')) return [{ id: 4 }, { id: 9 }]
      if (sql.includes('patch_resource') && sql.includes('FOR UPDATE')) {
        resourceLocked = true
        return [{ id: 10, patch_id: 20, status: 0, user_id: 7 }]
      }
      if (sql.includes('FOR UPDATE')) return [{ id: 1 }]
      return []
    })
    db.ops_case.findUnique.mockImplementation(async (args) => {
      const select = args?.select ?? {}
      if (args?.where?.dedup_key) return null
      if (select.target_type === true && select.status !== true) {
        return { target_type: 'resource', target_id: 10 }
      }
      fullReads += 1
      return fullReads === 1 ? closedRow : null
    })
    db.patch_resource.findUnique.mockImplementation(async (args) => {
      if (args?.select?.publisher_left_at) {
        return {
          publisher_left_at: resourceLocked
            ? new Date('2026-11-04T00:00:00.000Z')
            : null
        }
      }
      if (args?.select?.name) return { name: 'card' }
      return null
    })
    db.ops_case.updateMany.mockResolvedValue({ count: 1 })
    const result = await reopenCase(1, 4, '请继续处理', {
      now,
      db: db as never
    })
    expect(result).toBe('问题不存在')
    const written = db.ops_case.updateMany.mock.calls[0]?.[0]
    expect(written.where).toMatchObject({
      status: 'resolved',
      revision: 2,
      reopened_count: 0
    })
    expect(written.data).toMatchObject({
      status: 'open',
      owner_type: 'staff',
      owner_id: null
    })
    expect(written.data.reopened_count).toEqual({ increment: 1 })
    const sql = db.$queryRaw.mock.calls.map((call) => String(call[0]?.sql ?? ''))
    const resourceLockAt = sql.findIndex(
      (text) => text.includes('patch_resource') && text.includes('FOR UPDATE')
    )
    const caseLockAt = sql.findIndex(
      (text) => text.includes('ops_case') && text.includes('FOR UPDATE')
    )
    expect(resourceLockAt).toBeGreaterThanOrEqual(0)
    expect(caseLockAt).toBeGreaterThan(resourceLockAt)
    expect(sql.some((text) => text.includes('publisher_left_at'))).toBe(false)
    const bodies = db.ops_case_message.create.mock.calls.map(
      (call) => call[0].data.body
    )
    expect(bodies).toEqual([
      '问题已重新提交，处理方会继续跟进。',
      '请继续处理'
    ])
    expect(db.user_message.createMany).toHaveBeenCalled()
    expect(Object.hasOwn(db, 'ops_case_subscriber')).toBe(false)
  })

  it('does not reopen when a merge has moved the closed case to another resource', async () => {
    let fullReads = 0
    db.ops_case.findUnique.mockImplementation(async (args) => {
      const select = args?.select ?? {}
      if (args?.where?.dedup_key) return null
      if (select.target_type === true && select.status !== true) {
        return { target_type: 'resource', target_id: 10 }
      }
      fullReads += 1
      if (fullReads > 1) return null
      return { ...closedRow, target_id: 8 }
    })
    db.ops_case.updateMany.mockResolvedValue({ count: 1 })
    const result = await reopenCase(1, 4, '请继续处理', {
      now,
      db: db as never
    })
    expect(result).toBe('该问题刚刚被他人处理，请刷新后重试')
    expect(db.ops_case.updateMany).not.toHaveBeenCalled()
    expect(db.ops_case_message.create).not.toHaveBeenCalled()
    const resourceLocks = db.$queryRaw.mock.calls.filter((call) => {
      const sql = String(call[0]?.sql ?? '')
      return sql.includes('patch_resource') && sql.includes('FOR UPDATE')
    })
    expect(resourceLocks).toHaveLength(1)
    const lockedIds = resourceLocks.flatMap((call) => call[0]?.values ?? [])
    expect(lockedIds).toContain(10)
    expect(lockedIds).not.toContain(8)
  })

  it('still rejects a second reopen and a case closed for more than 7 days', async () => {
    db.ops_case.findUnique.mockResolvedValue({
      ...closedRow,
      reopened_count: 1
    })
    await expect(
      reopenCase(1, 4, '请继续处理', { now, db: db as never })
    ).resolves.toBe('每个问题只能重开一次')
    db.ops_case.findUnique.mockResolvedValue({
      ...closedRow,
      closed_at: new Date('2026-10-01T00:00:00.000Z')
    })
    await expect(
      reopenCase(1, 4, '请继续处理', { now, db: db as never })
    ).resolves.toBe('该问题已超过 7 天，不能重开')
    expect(db.ops_case.updateMany).not.toHaveBeenCalled()
    expect(db.user_message.createMany).not.toHaveBeenCalled()
  })

  it('drops handed cards from the publisher link-case representation query', async () => {
    const raw = vi.fn(async (_query: { sql: string }) => [])
    await representedPublisherLinkCaseIds(7, { $queryRaw: raw } as never)
    expect(raw.mock.calls[0]?.[0].sql ?? '').toContain(
      'r.publisher_left_at IS NULL'
    )
  })
})
