import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    ops_case: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      updateMany: vi.fn()
    },
    ops_case_message: { create: vi.fn(), findMany: vi.fn() },
    ops_case_subscriber: { findMany: vi.fn() },
    patch_resource: { findMany: vi.fn() },
    patch: { findMany: vi.fn() },
    patch_comment: { findMany: vi.fn() },
    patch_rating: { findMany: vi.fn() },
    shoutbox: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    user_message: { createMany: vi.fn() }
  }
  return { prisma: tx, tx }
})

vi.mock('~/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('~/prisma/index', () => ({ prisma: mocks.prisma }))
vi.mock('~/app/api/patch/resource/_helper', () => ({
  updatePatchAttributes: vi.fn()
}))
vi.mock('~/app/api/patch/cache', () => ({
  invalidatePatchContentCache: vi.fn(),
  invalidatePatchListCaches: vi.fn()
}))
vi.mock('~/app/api/utils/message', () => ({ createMessage: vi.fn() }))

import {
  buildCaseDailyKey,
  buildCaseDedupKey,
  closeCaseInternal,
  getAdminCases,
  listCases
} from '~/app/api/case/service'
import { CASE_STATUSES } from '~/constants/case'
import { adminCaseListSchema, caseListSchema } from '~/validations/case'

const now = new Date('2026-09-13T15:59:59.999Z')

const row = () => ({
  id: 42,
  kind: 'content_violation',
  target_type: 'comment',
  target_id: 100,
  patch_id: 7,
  owner_type: 'staff',
  owner_id: null,
  status: 'open',
  resolution: null,
  public: false,
  source: 'user',
  dedup_key: 'comment:100:content_violation',
  daily_key: null,
  revision: 3,
  status_changed_at: now,
  queue_entered_at: now,
  closed_at: null,
  escalated_at: null,
  first_owner_response_at: null,
  hidden_at: null,
  restored_at: null,
  reopened_count: 0,
  reporter_id: 2,
  owner: null,
  reporter: null,
  _count: { subscribers: 3 },
  messages: [],
  created: now,
  updated: now
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.tx.$queryRaw.mockResolvedValue([{}])
  mocks.tx.ops_case.findUnique.mockResolvedValue(row())
  mocks.tx.ops_case.findMany.mockResolvedValue([])
  mocks.tx.ops_case.count.mockResolvedValue(0)
  mocks.tx.ops_case.groupBy.mockResolvedValue([])
  mocks.tx.ops_case.updateMany.mockResolvedValue({ count: 1 })
  mocks.tx.ops_case_message.create.mockResolvedValue({ id: 50 })
  mocks.tx.ops_case_message.findMany.mockResolvedValue([])
  mocks.tx.ops_case_subscriber.findMany.mockResolvedValue([
    { user_id: 3 },
    { user_id: 9 }
  ])
  mocks.tx.patch_resource.findMany.mockResolvedValue([])
  mocks.tx.patch.findMany.mockResolvedValue([])
  mocks.tx.patch_comment.findMany.mockResolvedValue([])
  mocks.tx.patch_rating.findMany.mockResolvedValue([])
  mocks.tx.shoutbox.findMany.mockResolvedValue([])
  mocks.tx.user.findMany.mockResolvedValue([{ id: 3 }, { id: 4 }, { id: 9 }])
  mocks.tx.user_message.createMany.mockResolvedValue({ count: 4 })
})

describe('case service contracts', () => {
  it('keeps dedup and Shanghai daily keys stable at the day boundary', () => {
    expect(buildCaseDedupKey('resource', 8, 'resource_mismatch')).toBe(
      'resource:8:resource_mismatch'
    )
    expect(buildCaseDailyKey(2, 'resource', 8, now)).toBe(
      '2:resource:8:2026-09-13'
    )
    expect(
      buildCaseDailyKey(2, 'resource', 8, new Date('2026-09-13T16:00:00.000Z'))
    ).toBe('2:resource:8:2026-09-14')
  })

  it('deduplicates close notices and prefers the staff link for staff users', async () => {
    await expect(
      closeCaseInternal(mocks.tx as never, {
        caseId: 42,
        expectedStatuses: ['open'],
        resolution: 'handled',
        actorType: 'staff',
        actorId: 99,
        now
      })
    ).resolves.toMatchObject({ changed: true })

    expect(mocks.tx.user_message.createMany).toHaveBeenCalledOnce()
    const data = mocks.tx.user_message.createMany.mock.calls[0][0].data as {
      recipient_id: number
      sender_id: number | null
      link: string
    }[]
    expect(data).toHaveLength(4)
    expect(data.map((message) => message.recipient_id).sort()).toEqual([
      2, 3, 4, 9
    ])
    expect(data.find((message) => message.recipient_id === 2)).toMatchObject({
      sender_id: null,
      link: '/issue/42'
    })
    for (const recipientId of [3, 4, 9]) {
      expect(
        data.filter((message) => message.recipient_id === recipientId)
      ).toHaveLength(1)
      expect(
        data.find((message) => message.recipient_id === recipientId)
      ).toMatchObject({
        sender_id: 99,
        link: '/dashboard/case/42'
      })
    }
  })

  it('returns an admin latest-message preview and batches polymorphic targets', async () => {
    const adminRow = {
      ...row(),
      messages: [
        {
          id: 51,
          kind: 'reply',
          event: null,
          body: '请补充截图',
          created: new Date('2026-09-13T16:00:00.000Z')
        }
      ]
    }
    mocks.tx.ops_case.findMany.mockResolvedValueOnce([adminRow])
    mocks.tx.ops_case.count.mockResolvedValueOnce(1)
    mocks.tx.patch.findMany.mockResolvedValueOnce([
      { id: 7, unique_id: 'patch-7', name: '测试条目' }
    ])
    mocks.tx.patch_comment.findMany.mockResolvedValueOnce([{ id: 100 }])
    const result = await getAdminCases(
      {
        status: 'open',
        kind: 'content_violation',
        page: 2,
        limit: 20,
        search: '月光'
      },
      { db: mocks.prisma as never, now }
    )

    expect(result).toMatchObject({ total: 1, page: 2, limit: 20 })
    expect(result.cases[0]).toMatchObject({
      id: 42,
      latestMessage: {
        id: 51,
        kind: 'reply',
        body: '请补充截图'
      }
    })
    const listArgs = mocks.tx.ops_case.findMany.mock.calls[0][0]
    expect(listArgs.where).toMatchObject({
      owner_type: 'staff',
      status: 'open',
      kind: 'content_violation'
    })
    expect(listArgs.where.OR).toContainEqual({
      messages: {
        some: { body: { contains: '月光', mode: 'insensitive' } }
      }
    })
    expect(listArgs.where.OR).toHaveLength(2)
    expect(listArgs.orderBy).toEqual([
      { status_changed_at: 'asc' },
      { id: 'asc' }
    ])
    expect(mocks.tx.patch.findMany).toHaveBeenCalledOnce()
    expect(mocks.tx.patch_comment.findMany).toHaveBeenCalledOnce()
  })

  it('counts list statuses across the whole tab instead of the status filter', async () => {
    mocks.tx.ops_case.groupBy.mockResolvedValueOnce([
      { status: 'open', _count: { _all: 4 } },
      { status: 'resolved', _count: { _all: 2 } }
    ])
    const result = await listCases(
      { tab: 'reported', status: 'open', page: 1, limit: 20 },
      2,
      1,
      { db: mocks.prisma as never }
    )
    if (typeof result === 'string') {
      throw new Error(result)
    }

    expect(mocks.tx.ops_case.count.mock.calls[0][0].where).toMatchObject({
      reporter_id: 2,
      status: 'open'
    })
    const countsArgs = mocks.tx.ops_case.groupBy.mock.calls[0][0]
    expect(countsArgs).toMatchObject({ by: ['status'], _count: { _all: true } })
    expect(countsArgs.where).toEqual({ reporter_id: 2 })
    expect(result.statusCounts).toEqual({
      open: 4,
      waiting_reporter: 0,
      waiting_owner: 0,
      resolved: 2,
      rejected: 0,
      merged: 0
    })
    expect(Object.keys(result.statusCounts).sort()).toEqual(
      [...CASE_STATUSES].sort()
    )
  })

  it('filters by a merged status tab without touching the counting scope', async () => {
    mocks.tx.ops_case.groupBy.mockResolvedValueOnce([
      { status: 'open', _count: { _all: 1 } },
      { status: 'waiting_owner', _count: { _all: 3 } }
    ])
    const result = await listCases(
      {
        tab: 'reported',
        statuses: ['open', 'waiting_owner'],
        page: 1,
        limit: 20
      },
      2,
      1,
      { db: mocks.prisma as never }
    )
    if (typeof result === 'string') {
      throw new Error(result)
    }

    const listWhere = mocks.tx.ops_case.findMany.mock.calls[0][0].where
    expect(listWhere.status).toEqual({ in: ['open', 'waiting_owner'] })
    expect(mocks.tx.ops_case.count.mock.calls[0][0].where.status).toEqual({
      in: ['open', 'waiting_owner']
    })
    expect(mocks.tx.ops_case.groupBy.mock.calls[0][0].where).toEqual({
      reporter_id: 2
    })
    // The merged tab's own number is the caller's sum of the two raw keys.
    expect(result.statusCounts.open + result.statusCounts.waiting_owner).toBe(4)
  })

  it('prefers statuses over a single status filter when both arrive', async () => {
    await listCases(
      {
        tab: 'reported',
        status: 'resolved',
        statuses: ['open', 'waiting_owner'],
        page: 1,
        limit: 20
      },
      2,
      1,
      { db: mocks.prisma as never }
    )

    expect(mocks.tx.ops_case.findMany.mock.calls[0][0].where.status).toEqual({
      in: ['open', 'waiting_owner']
    })
  })

  it('normalizes the status CSV and rejects an unknown segment', () => {
    expect(
      caseListSchema.parse({ statuses: 'open, waiting_owner ,open' }).statuses
    ).toEqual(['open', 'waiting_owner'])
    expect(caseListSchema.parse({ statuses: '' }).statuses).toBeUndefined()
    expect(caseListSchema.parse({}).statuses).toBeUndefined()
    expect(caseListSchema.safeParse({ statuses: 'open,bogus' }).success).toBe(
      false
    )
  })

  it('counts admin statuses within kind and search but across every status', async () => {
    mocks.tx.ops_case.groupBy.mockResolvedValueOnce([
      { status: 'open', _count: { _all: 18 } },
      { status: 'rejected', _count: { _all: 5 } }
    ])
    const result = await getAdminCases(
      {
        status: 'open',
        kind: 'content_violation',
        page: 1,
        limit: 20,
        search: '月光'
      },
      { db: mocks.prisma as never, now }
    )

    const countsArgs = mocks.tx.ops_case.groupBy.mock.calls[0][0]
    expect(countsArgs.where).not.toHaveProperty('status')
    expect(countsArgs.where).toMatchObject({
      owner_type: 'staff',
      kind: 'content_violation'
    })
    expect(countsArgs.where.OR).toHaveLength(2)
    expect(result.statusCounts).toEqual({
      open: 18,
      waiting_reporter: 0,
      waiting_owner: 0,
      resolved: 0,
      rejected: 5,
      merged: 0
    })
  })

  it('walks the admin status ladder from the most specific rung down', async () => {
    const adminList = (
      input: Partial<Parameters<typeof getAdminCases>[0]> = {}
    ) =>
      getAdminCases(
        { page: 1, limit: 20, search: '', ...input },
        {
          db: mocks.prisma as never,
          now
        }
      )
    const whereAt = (call: number) =>
      mocks.tx.ops_case.findMany.mock.calls[call][0].where

    await adminList({ statuses: ['open', 'waiting_owner'] })
    await adminList({ status: 'resolved' })
    await adminList({ allStatuses: true })
    await adminList()

    expect(whereAt(0).status).toEqual({ in: ['open', 'waiting_owner'] })
    expect(whereAt(1).status).toBe('resolved')
    expect(whereAt(2)).not.toHaveProperty('status')
    expect(whereAt(3).status).toEqual({
      in: ['open', 'waiting_reporter', 'waiting_owner']
    })
  })

  it('never lets a broader admin rung widen a concrete status selection', async () => {
    await getAdminCases(
      {
        status: 'resolved',
        statuses: ['open', 'waiting_owner'],
        allStatuses: true,
        page: 1,
        limit: 20,
        search: ''
      },
      { db: mocks.prisma as never, now }
    )
    await getAdminCases(
      {
        status: 'resolved',
        allStatuses: true,
        page: 1,
        limit: 20,
        search: ''
      },
      { db: mocks.prisma as never, now }
    )

    expect(mocks.tx.ops_case.findMany.mock.calls[0][0].where.status).toEqual({
      in: ['open', 'waiting_owner']
    })
    expect(mocks.tx.ops_case.findMany.mock.calls[1][0].where.status).toBe(
      'resolved'
    )
  })

  it('keeps every admin status parameter out of the counting scope', async () => {
    await getAdminCases(
      {
        statuses: ['open', 'waiting_owner'],
        allStatuses: true,
        kind: 'content_violation',
        page: 1,
        limit: 20,
        search: ''
      },
      { db: mocks.prisma as never, now }
    )

    expect(mocks.tx.ops_case.groupBy.mock.calls[0][0].where).toEqual({
      owner_type: 'staff',
      kind: 'content_violation'
    })
  })

  it('parses the admin status list and allStatuses flag, rejecting bad input', () => {
    expect(
      adminCaseListSchema.parse({ statuses: 'open,resolved' })
    ).toMatchObject({ statuses: ['open', 'resolved'] })
    expect(adminCaseListSchema.parse({ allStatuses: 'true' }).allStatuses).toBe(
      true
    )
    expect(
      adminCaseListSchema.parse({ allStatuses: 'false' }).allStatuses
    ).toBe(false)
    expect(adminCaseListSchema.parse({}).allStatuses).toBeUndefined()
    expect(
      adminCaseListSchema.safeParse({ statuses: 'open,bogus' }).success
    ).toBe(false)
    // 'false' must stay falsy: z.coerce.boolean() would read it as true.
    expect(adminCaseListSchema.safeParse({ allStatuses: '1' }).success).toBe(
      false
    )
  })

  it('keeps the default unresolved window out of the admin status counts', async () => {
    await getAdminCases(
      { page: 1, limit: 20, search: '' },
      { db: mocks.prisma as never, now }
    )

    expect(mocks.tx.ops_case.count.mock.calls[0][0].where.status).toEqual({
      in: ['open', 'waiting_reporter', 'waiting_owner']
    })
    expect(mocks.tx.ops_case.groupBy.mock.calls[0][0].where).toEqual({
      owner_type: 'staff'
    })
  })
})
