import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    $queryRaw: vi.fn(),
    patch_submission: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn()
    },
    patch_resource: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
    user_message: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    patch_report: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
    admin_log: { count: vi.fn() }
  }
}))

vi.mock('~/prisma/index', () => ({ prisma: mocks.prisma }))

import {
  getAdminInbox,
  getAdminInboxCounts,
  getAdminInboxItem
} from '~/app/api/admin/inbox/service'
import type { InboxQuery } from '~/types/api/inbox'

const now = new Date('2026-09-10T12:00:00.000Z')
const created = new Date('2026-09-01T00:00:00.000Z')
const user = { id: 2, name: '投稿者', avatar: '/avatar.png' }
const query: InboxQuery = {
  kinds: ['submission', 'resource-apply', 'feedback', 'report'],
  search: '',
  order: 'waiting',
  limitPerKind: 50
}
const submission = (id = 1) => ({
  id,
  name: '月光',
  status: 'pending',
  submitted_at: null,
  reviewed_at: null,
  created,
  updated: created,
  user
})
const resource = () => ({
  id: 3,
  name: '汉化补丁',
  status: 2,
  note: '说明',
  section: 'patch',
  type: ['translation'],
  language: ['zh-CN'],
  platform: ['windows'],
  download: 4,
  user_id: 2,
  patch_id: 4,
  created,
  patch: { name: '月光', unique_id: 'moon' },
  user: { ...user, role: 2, _count: { patch_resource: 5 } },
  links: [
    {
      id: 8,
      storage: 's3',
      size: '1 MB',
      code: 'code',
      password: 'password',
      hash: 'hash',
      content: 'https://example.com/file',
      sort_order: 0,
      download: 4
    }
  ]
})
const feedback = () => ({
  id: 4,
  type: 'feedback',
  status: 0,
  content: '页面打不开',
  link: '/',
  created,
  sender: user,
  sender_id: user.id,
  recipient_id: null
})
const report = (id = 5, targetType = 'comment') => ({
  id,
  target_type: targetType,
  status: 0,
  reason: '有问题',
  handler_reply: '',
  handled_at: null,
  created,
  sender: user,
  reported_user: { ...user, id: 9 },
  patch: { id: 4, unique_id: 'moon', name: '月光' },
  comment_id: targetType === 'comment' ? 10 : null,
  rating_id: targetType === 'rating' ? 11 : null,
  comment: targetType === 'comment' ? { id: 10, content: '评论内容' } : null,
  rating:
    targetType === 'rating'
      ? {
          id: 11,
          short_summary: '评价内容',
          overall: 8,
          recommend: 'yes',
          play_status: 'played'
        }
      : null
})

beforeEach(() => {
  vi.resetAllMocks()
  mocks.prisma.$queryRaw.mockResolvedValue([])
  for (const model of [
    mocks.prisma.patch_submission,
    mocks.prisma.patch_resource,
    mocks.prisma.user_message,
    mocks.prisma.patch_report
  ]) {
    model.findMany.mockResolvedValue([])
    model.count.mockResolvedValue(0)
  }
  mocks.prisma.admin_log.count.mockResolvedValue(0)
})

describe('admin inbox candidates', () => {
  it('orders nullable submission waiting times in SQL before limiting candidates', async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([{ id: 1 }, { id: 2 }])
    mocks.prisma.patch_submission.findMany.mockResolvedValue([
      { ...submission(2), submitted_at: new Date('2026-09-09T00:00:00Z') },
      submission(1)
    ])
    mocks.prisma.patch_submission.count.mockResolvedValue(70)
    const result = await getAdminInbox(
      { ...query, kinds: ['submission'], limitPerKind: 2 },
      now
    )
    const sql = mocks.prisma.$queryRaw.mock.calls[0][0]
    expect(sql.text).toMatch(
      /ORDER BY COALESCE\(\w*\.?"?submitted_at"?,\s*\w*\.?"?created"?\) ASC,\s*\w*\.?"?id"? ASC\s+LIMIT/i
    )
    expect(sql.values).toContain(2)
    expect(mocks.prisma.patch_submission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'pending', id: { in: [1, 2] } }
      })
    )
    expect(result.items.map((item) => item.id)).toEqual([1, 2])
    expect(result.items[0]).toMatchObject({
      waitingFrom: created.toISOString(),
      waitingSeconds: (now.getTime() - created.getTime()) / 1000
    })
    expect(result.totals.submission).toBe(70)
    expect(result.truncated.submission).toBe(true)
    expect(mocks.prisma.patch_resource.findMany).not.toHaveBeenCalled()
  })

  it('uses exact pending predicates, both report types, and no resource NSFW preference', async () => {
    await getAdminInbox(query, now)
    expect(mocks.prisma.patch_submission.count).toHaveBeenCalledWith({
      where: { status: 'pending' }
    })
    expect(mocks.prisma.patch_resource.count).toHaveBeenCalledWith({
      where: { status: 2 }
    })
    expect(mocks.prisma.user_message.count).toHaveBeenCalledWith({
      where: {
        type: 'feedback',
        sender_id: { not: null },
        recipient_id: null,
        status: 0
      }
    })
    expect(mocks.prisma.patch_report.count).toHaveBeenCalledWith({
      where: {
        status: 0,
        OR: [
          { target_type: 'shoutbox', shoutbox_id: { not: null } },
          {
            target_type: { in: ['comment', 'rating'] },
            patch_id: { not: null }
          }
        ]
      }
    })
    for (const model of [
      mocks.prisma.patch_resource,
      mocks.prisma.user_message,
      mocks.prisma.patch_report
    ]) {
      expect(model.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
          orderBy: [{ created: 'asc' }, { id: 'asc' }]
        })
      )
    }
  })

  it('serializes existing admin payloads and preserves one queue row per report', async () => {
    mocks.prisma.patch_resource.findMany.mockResolvedValue([resource()])
    mocks.prisma.user_message.findMany.mockResolvedValue([feedback()])
    mocks.prisma.patch_report.findMany.mockResolvedValue([
      report(5),
      report(6, 'rating')
    ])
    mocks.prisma.patch_report.count.mockResolvedValue(2)
    const result = await getAdminInbox(query, now)
    expect(result.items).toHaveLength(4)
    const resourceItem = result.items.find(
      (item) => item.kind === 'resource-apply'
    )!
    expect(resourceItem).toMatchObject({
      readOnly: false,
      actor: user,
      payload: {
        created: created.toISOString(),
        uniqueId: 'moon',
        links: [
          {
            content: 'https://example.com/file',
            code: 'code',
            password: 'password',
            sortOrder: 0
          }
        ]
      }
    })
    expect(result.items.find((item) => item.kind === 'feedback')).toMatchObject(
      {
        readOnly: true,
        payload: { content: '页面打不开', created: created.toISOString() }
      }
    )
    expect(
      result.items
        .filter((item) => item.kind === 'report')
        .map((item) => item.id)
    ).toEqual([5, 6])
    expect(mocks.prisma.patch_report.count).toHaveBeenCalledWith({
      where: {
        status: 0,
        target_type: 'comment',
        comment_id: 10,
        id: { not: 5 }
      }
    })
    expect(mocks.prisma.patch_report.count).toHaveBeenCalledWith({
      where: {
        status: 0,
        target_type: 'rating',
        rating_id: 11,
        id: { not: 6 }
      }
    })
  })

  it('keeps nullable patch reports out of the legacy queue and totals', async () => {
    mocks.prisma.patch_report.findMany.mockResolvedValue([
      report(5),
      { ...report(6), patch: null },
      { ...report(7, 'shoutbox'), patch: null, shoutbox: null }
    ])
    mocks.prisma.patch_report.count.mockResolvedValue(1)

    const result = await getAdminInbox(
      { ...query, kinds: ['report'], limitPerKind: 50 },
      now
    )

    expect(result.items.map((item) => item.id)).toEqual([5])
    expect(result.totals.report).toBe(1)
    expect(result.truncated.report).toBe(false)
    expect(mocks.prisma.patch_report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 0,
          OR: [
            { target_type: 'shoutbox', shoutbox_id: { not: null } },
            {
              target_type: { in: ['comment', 'rating'] },
              patch_id: { not: null }
            }
          ]
        }
      })
    )
  })

  it('searches the database before limiting and uses the same predicates for totals', async () => {
    await getAdminInbox({ ...query, search: '月光' }, now)
    const sql = mocks.prisma.$queryRaw.mock.calls[0][0]
    expect(sql.text).toMatch(/ILIKE/)
    expect(sql.text).not.toContain('月光')
    expect(sql.values).toContain('%月光%')
    expect(mocks.prisma.patch_submission.count).toHaveBeenCalledWith({
      where: {
        status: 'pending',
        OR: [
          { name: { contains: '月光', mode: 'insensitive' } },
          { user: { name: { contains: '月光', mode: 'insensitive' } } }
        ]
      }
    })
    for (const model of [
      mocks.prisma.patch_resource,
      mocks.prisma.user_message,
      mocks.prisma.patch_report
    ]) {
      const where = model.findMany.mock.calls[0][0].where
      expect(where.OR.length).toBeGreaterThan(1)
      expect(model.count).toHaveBeenCalledWith({ where })
    }
  })

  it('adds an exact source ID match for a numeric search', async () => {
    await getAdminInbox({ ...query, search: '123' }, now)
    for (const model of [
      mocks.prisma.patch_submission,
      mocks.prisma.patch_resource,
      mocks.prisma.user_message,
      mocks.prisma.patch_report
    ]) {
      const where = model.count.mock.calls[0][0].where
      const searchOr = where.AND?.[0]?.OR ?? where.OR
      expect(searchOr).toContainEqual({ id: 123 })
    }
    expect(mocks.prisma.$queryRaw.mock.calls[0][0].values).toContain(123)
  })

  it('groups sources on the server while preserving oldest order within each source', async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([{ id: 1 }])
    mocks.prisma.patch_submission.findMany.mockResolvedValue([submission()])
    mocks.prisma.user_message.findMany.mockResolvedValue([
      { ...feedback(), created: new Date('2026-08-01Z') }
    ])
    const result = await getAdminInbox({ ...query, order: 'kind' }, now)
    expect(result.items.map((item) => item.kind)).toEqual([
      'submission',
      'feedback'
    ])
  })
})

describe('admin inbox deep links', () => {
  it.each(['pending', 'published'] as const)(
    'reads %s submission outside the candidate window',
    async (status) => {
      mocks.prisma.patch_submission.findUnique.mockResolvedValue({
        ...submission(),
        status
      })
      const result = await getAdminInboxItem({ kind: 'submission', id: 1 }, now)
      expect(result.state).toBe(status === 'pending' ? 'pending' : 'processed')
      expect(result.item?.key).toBe('submission:1')
      expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled()
    }
  )

  it('returns missing for a removed resource', async () => {
    mocks.prisma.patch_resource.findUnique.mockResolvedValue(null)
    expect(
      await getAdminInboxItem({ kind: 'resource-apply', id: 3 }, now)
    ).toEqual({ state: 'missing', item: null })
  })

  it('does not expose unrelated private messages as feedback', async () => {
    mocks.prisma.user_message.findFirst.mockResolvedValue(null)
    expect(await getAdminInboxItem({ kind: 'feedback', id: 4 }, now)).toEqual({
      state: 'missing',
      item: null
    })
    expect(mocks.prisma.user_message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 4,
          type: 'feedback',
          sender_id: { not: null },
          recipient_id: null
        }
      })
    )
  })

  it('keeps handled reports readable and does not match unrelated deleted targets', async () => {
    mocks.prisma.patch_report.findUnique.mockResolvedValue({
      ...report(),
      status: 2,
      comment_id: null,
      comment: null,
      handled_at: now
    })
    const result = await getAdminInboxItem({ kind: 'report', id: 5 }, now)
    expect(result).toMatchObject({
      state: 'processed',
      item: {
        payload: { pendingForTarget: 0, handledAt: now.toISOString() }
      }
    })
    expect(mocks.prisma.patch_report.count).not.toHaveBeenCalled()
  })

  it.each([
    ['comment', '/admin/report'],
    ['rating', '/admin/rating-report']
  ])(
    'links %s reports to the matching legacy processing page',
    async (targetType, targetHref) => {
      mocks.prisma.patch_report.findUnique.mockResolvedValue(
        report(5, targetType)
      )
      const result = await getAdminInboxItem({ kind: 'report', id: 5 }, now)
      expect(result.item?.targetHref).toBe(targetHref)
    }
  )

  it('links shoutbox reports to the dashboard review page', async () => {
    mocks.prisma.patch_report.findUnique.mockResolvedValue({
      ...report(5, 'shoutbox'),
      patch: null,
      shoutbox: {
        id: 12,
        content: '小喇叭内容',
        official: false,
        level: 'normal',
        status: 2,
        cost: 50,
        created,
        hidden_at: created,
        refunded_at: null,
        patch: null
      }
    })

    const result = await getAdminInboxItem({ kind: 'report', id: 5 }, now)

    expect(result.item?.targetHref).toBe(
      '/dashboard/shoutbox?tab=pending_review'
    )
  })

  it('returns processed for approved resource applications', async () => {
    mocks.prisma.patch_resource.findUnique.mockResolvedValue({
      ...resource(),
      status: 0
    })
    const result = await getAdminInboxItem(
      { kind: 'resource-apply', id: 3 },
      now
    )
    expect(result).toMatchObject({
      state: 'processed',
      item: { key: 'resource-apply:3' }
    })
  })

  it('reads handled feedback within the same sender and recipient scope', async () => {
    mocks.prisma.user_message.findFirst.mockResolvedValue({
      ...feedback(),
      status: 1
    })
    const result = await getAdminInboxItem({ kind: 'feedback', id: 4 }, now)
    expect(result).toMatchObject({
      state: 'processed',
      item: { key: 'feedback:4' }
    })
    expect(
      mocks.prisma.user_message.findFirst.mock.calls[0][0].where
    ).not.toHaveProperty('status')
  })

  it('returns missing for a report ID without falling back to another source', async () => {
    mocks.prisma.patch_report.findUnique.mockResolvedValue(null)
    mocks.prisma.patch_submission.findUnique.mockResolvedValue(submission(5))
    expect(await getAdminInboxItem({ kind: 'report', id: 5 }, now)).toEqual({
      state: 'missing',
      item: null
    })
    expect(mocks.prisma.patch_submission.findUnique).not.toHaveBeenCalled()
    expect(mocks.prisma.user_message.findFirst).not.toHaveBeenCalled()
  })

  it('returns missing for a legacy report whose patch was removed', async () => {
    mocks.prisma.patch_report.findUnique.mockResolvedValue({
      ...report(),
      patch: null
    })

    expect(await getAdminInboxItem({ kind: 'report', id: 5 }, now)).toEqual({
      state: 'missing',
      item: null
    })
    expect(mocks.prisma.patch_report.count).not.toHaveBeenCalled()
  })
})

describe('admin inbox counts', () => {
  it('counts the full pending backlog and only the current reviewer dedicated action logs', async () => {
    mocks.prisma.patch_submission.count.mockResolvedValue(100)
    mocks.prisma.patch_resource.count.mockResolvedValue(20)
    mocks.prisma.user_message.count.mockResolvedValue(30)
    mocks.prisma.patch_report.count.mockResolvedValue(40)
    mocks.prisma.admin_log.count.mockResolvedValue(7)
    expect(await getAdminInboxCounts(9, now)).toEqual({
      pending: {
        submission: 100,
        'resource-apply': 20,
        feedback: 30,
        report: 40
      },
      todayProcessed: 7
    })
    expect(mocks.prisma.admin_log.count).toHaveBeenCalledWith({
      where: {
        user_id: 9,
        created: {
          gte: new Date('2026-09-09T16:00:00Z'),
          lt: new Date('2026-09-10T16:00:00Z')
        },
        type: {
          in: [
            'submission_review',
            'resource_apply_approve',
            'resource_apply_decline'
          ]
        }
      }
    })
  })

  it.each([
    ['2026-09-10T15:59:59.999Z', '2026-09-09T16:00:00Z'],
    ['2026-09-10T16:00:00.000Z', '2026-09-10T16:00:00Z']
  ])('changes daily windows at Shanghai midnight %s', async (time, start) => {
    await getAdminInboxCounts(3, new Date(time))
    expect(
      mocks.prisma.admin_log.count.mock.calls[0][0].where.created.gte
    ).toEqual(new Date(start))
  })
})
