import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    ops_case: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      updateMany: vi.fn()
    },
    ops_case_message: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    ops_case_subscriber: { findMany: vi.fn() },
    patch_resource: { findMany: vi.fn() },
    patch: { findMany: vi.fn() },
    patch_comment: { findMany: vi.fn() },
    patch_rating: { findMany: vi.fn() },
    shoutbox: { findMany: vi.fn(), findUnique: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    user_message: { createMany: vi.fn(), findMany: vi.fn() },
    admin_log: { create: vi.fn() }
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
vi.mock('~/app/api/case/rateLimit', () => ({
  checkCaseRateLimit: vi.fn().mockResolvedValue(null)
}))

import {
  buildCaseDailyKey,
  buildCaseDedupKey,
  closeCaseInternal,
  getAdminCaseInboxItems,
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

// An admin search first reads the resources its queue targets (`distinct` on
// target_id); every other `ops_case.findMany` is a list query.
type FindManyArgs = {
  distinct?: unknown
  where: { OR?: unknown[]; [key: string]: unknown }
}
const findManyCalls = () =>
  mocks.tx.ops_case.findMany.mock.calls.map(([args]) => args as FindManyArgs)
const isTargetQuery = (args: FindManyArgs) => args.distinct !== undefined
const listCalls = () => findManyCalls().filter((args) => !isTargetQuery(args))
const targetCalls = () => findManyCalls().filter(isTargetQuery)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.tx.$queryRaw.mockResolvedValue([{}])
  mocks.tx.ops_case.findUnique.mockResolvedValue(row())
  mocks.tx.ops_case.findFirst.mockResolvedValue(null)
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
  mocks.tx.shoutbox.findUnique.mockResolvedValue(null)
  mocks.tx.user.findMany.mockResolvedValue([{ id: 3 }, { id: 4 }, { id: 9 }])
  mocks.tx.user.findUnique.mockResolvedValue(null)
  mocks.tx.user_message.createMany.mockResolvedValue({ count: 4 })
  mocks.tx.user_message.findMany.mockResolvedValue([])
})

describe('case service contracts', () => {
  it('redacts a hidden reply in the reporter list preview', async () => {
    mocks.tx.ops_case.findMany.mockResolvedValueOnce([
      {
        ...row(),
        messages: [
          {
            id: 61,
            kind: 'reply',
            event: null,
            body: '已隐藏的原文',
            payload: { hidden_at: now.toISOString() },
            created: now
          }
        ]
      }
    ])
    const result = await listCases(
      { tab: 'reported', page: 1, limit: 20 },
      2,
      1,
      { db: mocks.prisma as never }
    )
    if (typeof result === 'string') throw new Error(result)
    expect(result.cases[0].latestMessage).toMatchObject({
      id: 61,
      body: '该内容已被网站管理员隐藏。'
    })
    expect(JSON.stringify(result)).not.toContain('已隐藏的原文')
    expect(result.cases[0].latestMessage).not.toHaveProperty('payload')
  })

  it('never previews another reporter’s note to a violation report opener (D31)', async () => {
    mocks.tx.ops_case.findMany.mockResolvedValueOnce([
      {
        ...row(),
        messages: [
          {
            id: 62,
            kind: 'report',
            event: null,
            body: '另一位举报人的理由',
            payload: null,
            created: now
          }
        ]
      }
    ])
    mocks.tx.ops_case_message.findFirst.mockResolvedValueOnce({
      id: 61,
      kind: 'reply',
      event: null,
      body: '开启者自己的说明',
      payload: null,
      created: now
    })
    const result = await listCases(
      { tab: 'reported', page: 1, limit: 20 },
      2,
      1,
      { db: mocks.prisma as never }
    )
    if (typeof result === 'string') throw new Error(result)
    expect(mocks.tx.ops_case_message.findFirst.mock.calls[0][0].where).toEqual({
      case_id: 42,
      OR: [
        { author_id: 2 },
        { kind: 'reply', author: { is: { role: { gte: 3 } } } },
        {
          kind: 'system',
          OR: [{ event: null }, { event: { not: 'withdrawn' } }]
        }
      ]
    })
    expect(result.cases[0].latestMessage).toMatchObject({
      id: 61,
      body: '开启者自己的说明'
    })
    // Like a follower, the opener gets no reporter count on a private report.
    expect(result.cases[0].subscriberCount).toBeNull()
    expect(JSON.stringify(result)).not.toContain('另一位举报人的理由')
  })

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

    // Every staff closure counts toward「今日已处理」(review item 24).
    expect(mocks.tx.admin_log.create).toHaveBeenCalledWith({
      data: {
        type: 'case_close',
        user_id: 99,
        content: '管理员以「已处理」结案问题 #42'
      }
    })
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
    mocks.tx.ops_case.findMany.mockImplementation(async (args: FindManyArgs) =>
      isTargetQuery(args) ? [] : [adminRow]
    )
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
    const [listArgs] = listCalls() as Array<FindManyArgs & { orderBy: unknown }>
    expect(listArgs.where).toMatchObject({
      owner_type: 'staff',
      status: 'open',
      kind: 'content_violation'
    })
    // The resource lookup keeps the queue but not the status filter, which
    // the status counts must not inherit.
    expect(targetCalls().map((args) => args.where)).toEqual([
      {
        owner_type: 'staff',
        kind: 'content_violation',
        target_type: 'resource'
      }
    ])
    // Review item 25: dialogue text, game name and reporter name besides the
    // kind code; no case targets a resource, and '月光' names no kind.
    const contains = { contains: '月光', mode: 'insensitive' }
    expect(listArgs.where.OR).toEqual([
      { kind: contains },
      { messages: { some: { body: contains } } },
      { patch: { name: contains } },
      { reporter: { name: contains } }
    ])
    expect(listArgs.orderBy).toEqual([
      { status_changed_at: 'asc' },
      { id: 'asc' }
    ])
    expect(mocks.tx.patch.findMany).toHaveBeenCalledOnce()
    expect(mocks.tx.patch_comment.findMany).toHaveBeenCalledOnce()
  })

  it('finds a case by its number, a kind label or a resource name (item 25)', async () => {
    const contains = (search: string) => ({
      contains: search,
      mode: 'insensitive'
    })
    const searchWhere = async (search: string) => {
      mocks.tx.ops_case.findMany.mockClear()
      await getAdminCases(
        { page: 1, limit: 20, search },
        { db: mocks.prisma as never, now }
      )
      return listCalls()[0].where.OR ?? []
    }

    const byId = await searchWhere('42')
    expect(byId[0]).toEqual({ id: 42 })
    expect(byId).toHaveLength(5)
    // Past the int4 range the text is still searched, just not as an id.
    expect(await searchWhere('2147483648')).not.toContainEqual({
      id: 2147483648
    })

    expect(await searchWhere('链接')).toContainEqual({
      kind: {
        in: ['resource_link_failure', 'link_suspect', 'link_disputed']
      }
    })
    // No case in the queue targets a resource, so no resource is read.
    expect(mocks.tx.patch_resource.findMany).not.toHaveBeenCalled()

    mocks.tx.ops_case.findMany.mockImplementation(async (args: FindManyArgs) =>
      isTargetQuery(args)
        ? [{ target_id: 8 }, { target_id: 9 }, { target_id: 30 }]
        : []
    )
    mocks.tx.patch_resource.findMany.mockResolvedValueOnce([
      { id: 9 },
      { id: 8 }
    ])
    const byResource = await searchWhere('体验版')
    expect(mocks.tx.patch_resource.findMany).toHaveBeenLastCalledWith({
      where: { id: { in: [8, 9, 30] }, name: contains('体验版') },
      select: { id: true }
    })
    expect(byResource).toContainEqual({
      target_type: 'resource',
      target_id: { in: [9, 8] }
    })
  })

  it('narrows the search to the chosen field (M03-9)', async () => {
    const contains = (search: string) => ({
      contains: search,
      mode: 'insensitive'
    })
    const searchWhere = async (
      search: string,
      searchField: 'id' | 'content' | 'reporter'
    ) => {
      mocks.tx.ops_case.findMany.mockClear()
      await getAdminCases(
        { page: 1, limit: 20, search, searchField },
        { db: mocks.prisma as never, now }
      )
      return listCalls()[0].where.OR
    }

    expect(await searchWhere('8', 'id')).toEqual([{ id: 8 }])
    expect(await searchWhere('#8', 'id')).toEqual([{ id: 8 }])
    // Text in the number field matches nothing rather than everything.
    expect(await searchWhere('体验版', 'id')).toEqual([])
    expect(await searchWhere('8', 'content')).toEqual([
      { messages: { some: { body: contains('8') } } }
    ])
    expect(await searchWhere('saya', 'reporter')).toEqual([
      { reporter: { name: contains('saya') } }
    ])
    // Only the resource scope reads the case targets and the resource table.
    expect(targetCalls()).toHaveLength(0)
    expect(mocks.tx.patch_resource.findMany).not.toHaveBeenCalled()
    // A scoped search keeps the waiting order; only 全部 lifts a named case.
    expect(mocks.tx.ops_case.findFirst).not.toHaveBeenCalled()
    // The schema defaults to `all` and rejects an unknown field.
    expect(
      adminCaseListSchema.parse({ search: '8', searchField: 'id' }).searchField
    ).toBe('id')
    expect(adminCaseListSchema.parse({ search: '8' }).searchField).toBe('all')
    expect(
      adminCaseListSchema.safeParse({ search: '8', searchField: 'owner' })
        .success
    ).toBe(false)
  })

  it('lists the case a 全部 search names first, without repeating it (M03-9)', async () => {
    mocks.tx.ops_case.findFirst.mockResolvedValue({ ...row(), id: 8 })
    mocks.tx.ops_case.findMany.mockResolvedValue([{ ...row(), id: 2 }])
    mocks.tx.ops_case.count.mockResolvedValue(3)
    const pageArgs = () =>
      listCalls()[0] as unknown as {
        where: Record<string, unknown>
        skip: number
        take: number
      }

    const first = await getAdminCases(
      { page: 1, limit: 20, search: '8' },
      { db: mocks.prisma as never, now }
    )
    expect(first.cases.map((item) => item.id)).toEqual([8, 2])
    expect(first.total).toBe(3)
    expect(mocks.tx.ops_case.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 8,
      owner_type: 'staff'
    })
    expect(pageArgs().where.id).toEqual({ not: 8 })
    expect(pageArgs()).toMatchObject({ skip: 0, take: 19 })

    // Later pages shift by the lifted row instead of showing it again.
    mocks.tx.ops_case.findMany.mockClear()
    const second = await getAdminCases(
      { page: 2, limit: 20, search: '#8' },
      { db: mocks.prisma as never, now }
    )
    expect(second.cases.map((item) => item.id)).toEqual([2])
    expect(pageArgs()).toMatchObject({ skip: 19, take: 20 })

    // A number outside the filter changes nothing.
    mocks.tx.ops_case.findFirst.mockResolvedValue(null)
    mocks.tx.ops_case.findMany.mockClear()
    await getAdminCases(
      { page: 1, limit: 20, search: '8' },
      { db: mocks.prisma as never, now }
    )
    expect(pageArgs().where.id).toBeUndefined()
    expect(pageArgs()).toMatchObject({ skip: 0, take: 20 })
  })

  it('matches resource names among every resource its queue targets, uncut (item 25)', async () => {
    const ids = Array.from({ length: 201 }, (_, index) => index + 1)
    mocks.tx.ops_case.findMany.mockImplementation(async (args: FindManyArgs) =>
      isTargetQuery(args) ? ids.map((target_id) => ({ target_id })) : []
    )
    mocks.tx.patch_resource.findMany.mockImplementation(
      async ({ where }: { where: { id: { in: number[] } } }) =>
        where.id.in.map((id) => ({ id }))
    )

    await getAdminCases(
      { status: 'open', page: 1, limit: 20, search: '体验版' },
      { db: mocks.prisma as never, now }
    )
    await getAdminCaseInboxItems(
      { limit: 20, search: '体验版' },
      now,
      mocks.prisma as never
    )

    // The case center looks across every status for its counts; the inbox
    // only among the cases waiting on the handler.
    expect(targetCalls().map((args) => args.where)).toEqual([
      { owner_type: 'staff', target_type: 'resource' },
      {
        owner_type: 'staff',
        status: { in: ['open', 'waiting_owner'] },
        target_type: 'resource'
      }
    ])
    for (const args of [
      ...targetCalls(),
      ...mocks.tx.patch_resource.findMany.mock.calls.map(([args]) => args)
    ]) {
      expect(args).not.toHaveProperty('take')
    }
    for (const [args] of mocks.tx.patch_resource.findMany.mock.calls) {
      expect(args.where.id).toEqual({ in: ids })
    }
    const resourceMatch = { target_type: 'resource', target_id: { in: ids } }
    for (const args of listCalls()) {
      expect(args.where.OR).toContainEqual(resourceMatch)
    }
    for (const [args] of mocks.tx.ops_case.count.mock.calls) {
      expect(args.where.OR).toContainEqual(resourceMatch)
    }
    expect(mocks.tx.ops_case.groupBy.mock.calls[0][0].where.OR).toContainEqual(
      resourceMatch
    )
  })

  it('names a live target without a game in the inbox row and calls only a missing one deleted', async () => {
    mocks.tx.ops_case.findMany.mockResolvedValueOnce([
      {
        ...row(),
        id: 7,
        target_type: 'shoutbox',
        target_id: 24,
        patch_id: null
      },
      { ...row(), id: 8, target_type: 'user', target_id: 11, patch_id: null },
      { ...row(), id: 9, target_type: 'user', target_id: 12, patch_id: null }
    ])
    mocks.tx.shoutbox.findUnique.mockResolvedValue({
      id: 24,
      status: 0,
      content: '加群领资源',
      user: { id: 11, name: '发帖人', avatar: '' }
    })
    mocks.tx.user.findUnique.mockImplementation(
      async ({ where }: { where: { id: number } }) =>
        where.id === 11 ? { id: 11, name: '被举报用户', avatar: '' } : null
    )

    const { items } = await getAdminCaseInboxItems(
      { limit: 20 },
      now,
      mocks.prisma as never
    )

    expect(items.map((item) => item.subtitle)).toEqual([
      '小喇叭 #24',
      '用户 #11',
      '目标已删除'
    ])
  })

  it('feeds the inbox only staff cases waiting on the handler (D23)', async () => {
    await getAdminCaseInboxItems({ limit: 20 }, now, mocks.prisma as never)
    await getAdminCaseInboxItems(
      { limit: 20, search: '月光' },
      now,
      mocks.prisma as never
    )

    const waitingHandler = {
      owner_type: 'staff',
      status: { in: ['open', 'waiting_owner'] }
    }
    const [plain, searched] = listCalls()
    expect(plain.where).toEqual(waitingHandler)
    expect(mocks.tx.ops_case.count.mock.calls[0][0].where).toEqual(
      waitingHandler
    )
    expect(searched.where).toMatchObject(waitingHandler)
    expect(searched.where.OR).toHaveLength(4)
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
    expect(countsArgs.where.OR).toHaveLength(4)
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
