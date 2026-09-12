import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    shoutbox: {
      findUnique: vi.fn(),
      updateMany: vi.fn()
    },
    patch_report: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn()
    },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    user_message: { create: vi.fn() },
    admin_log: { create: vi.fn() }
  },
  createMessage: vi.fn(),
  invalidateShoutboxCaches: vi.fn(),
  spendMoemoepoint: vi.fn(),
  refundMoemoepoint: vi.fn(),
  getCurrentBalance: vi.fn()
}))

vi.mock('~/prisma/index', () => ({ prisma: mocks.prisma }))
vi.mock('~/app/api/utils/message', () => ({
  createMessage: mocks.createMessage
}))
vi.mock('~/app/api/shoutbox/cache', () => ({
  invalidateShoutboxCaches: mocks.invalidateShoutboxCaches,
  getShoutboxCached: vi.fn(),
  getShoutboxCacheKey: vi.fn(),
  getShoutboxBannerCached: vi.fn(),
  getShoutboxBannerCacheKey: vi.fn(),
  SHOUTBOX_LIST_CACHE_DURATION: 60,
  SHOUTBOX_BANNER_CACHE_DURATION: 60,
  SHOUTBOX_PATCH_CACHE_DURATION: 300
}))
vi.mock('~/app/api/moemoepoint/service', () => ({
  MoemoepointInsufficientError: class extends Error {},
  getCurrentBalance: mocks.getCurrentBalance,
  refundMoemoepoint: mocks.refundMoemoepoint,
  spendMoemoepoint: mocks.spendMoemoepoint
}))

import {
  createShoutboxReport,
  moderateShoutbox
} from '~/app/api/shoutbox/service'
import {
  shoutboxReportSchema,
  adminShoutboxModerateSchema
} from '~/validations/shoutbox'

const now = new Date('2026-09-12T04:00:00.000Z')
const message = (overrides: Record<string, unknown> = {}) => ({
  id: 12,
  user_id: 7,
  content: '正文',
  link: '',
  official: false,
  level: 'normal',
  status: 0,
  cost: 50,
  patch_id: null,
  effective_from: null,
  effective_to: null,
  hidden_at: null,
  refunded_at: null,
  ...overrides
})

const reportInput = { shoutboxId: 12, content: '违规内容' }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.prisma.$transaction.mockImplementation(async (callback) =>
    callback(mocks.prisma)
  )
  mocks.prisma.$queryRaw.mockResolvedValue([message()])
  mocks.prisma.shoutbox.findUnique.mockResolvedValue(message())
  mocks.prisma.shoutbox.updateMany.mockResolvedValue({ count: 1 })
  mocks.prisma.patch_report.findFirst.mockResolvedValue(null)
  mocks.prisma.patch_report.findMany.mockResolvedValue([])
  mocks.prisma.patch_report.create.mockResolvedValue({ id: 30, sender_id: 8 })
  mocks.prisma.patch_report.updateMany.mockResolvedValue({ count: 1 })
  mocks.prisma.user.findUnique.mockResolvedValue({ role: 1 })
  mocks.prisma.user.findMany.mockResolvedValue([])
  mocks.prisma.admin_log.create.mockResolvedValue({})
  mocks.createMessage.mockResolvedValue({})
  mocks.invalidateShoutboxCaches.mockResolvedValue(undefined)
})

describe('shoutbox report and moderation contracts', () => {
  it('rejects a report for a missing message without inserting a report', async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([])
    mocks.prisma.shoutbox.findUnique.mockResolvedValueOnce(null)

    const result = await createShoutboxReport(reportInput, 8, {
      now,
      db: mocks.prisma as never
    })

    expect(result).toBe('小喇叭不存在')
    expect(mocks.prisma.$queryRaw.mock.calls[0][0].text).toContain('FOR UPDATE')
    expect(mocks.prisma.shoutbox.findUnique).not.toHaveBeenCalled()
    expect(mocks.prisma.patch_report.create).not.toHaveBeenCalled()
  })

  it('rejects a self report before inserting a report', async () => {
    const result = await createShoutboxReport(reportInput, 7, {
      now,
      db: mocks.prisma as never
    })

    expect(result).toBe('不能举报自己的小喇叭')
    expect(mocks.prisma.patch_report.create).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'rejects a report for a role-4 author (%s official) before any report side effect',
    async (official) => {
      mocks.prisma.$queryRaw.mockResolvedValueOnce([
        message({ official })
      ])
      mocks.prisma.user.findUnique.mockResolvedValueOnce({ role: 4 })

      const result = await createShoutboxReport(reportInput, 8, {
        now,
        db: mocks.prisma as never
      })

      expect(result).toBe('超级管理员发布的小喇叭不能举报')
      expect(mocks.prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 7 },
        select: { role: true }
      })
      expect(mocks.prisma.patch_report.findFirst).not.toHaveBeenCalled()
      expect(mocks.prisma.patch_report.create).not.toHaveBeenCalled()
      expect(mocks.prisma.patch_report.findMany).not.toHaveBeenCalled()
      expect(mocks.prisma.shoutbox.updateMany).not.toHaveBeenCalled()
      expect(mocks.prisma.user.findMany).not.toHaveBeenCalled()
      expect(mocks.createMessage).not.toHaveBeenCalled()
      expect(mocks.invalidateShoutboxCaches).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['an author-deleted message', { status: 1 }],
    ['a station-removed message', { status: 3 }]
  ])('rejects a report for %s', async (_label, overrides) => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([message(overrides)])

    const result = await createShoutboxReport(reportInput, 8, {
      now,
      db: mocks.prisma as never
    })

    expect(result).toBe('当前小喇叭不接受举报')
    expect(mocks.prisma.patch_report.create).not.toHaveBeenCalled()
  })

  it('rejects a duplicate pending report before inserting another row', async () => {
    mocks.prisma.patch_report.findFirst.mockResolvedValueOnce({ id: 20 })

    const result = await createShoutboxReport(reportInput, 8, {
      now,
      db: mocks.prisma as never
    })

    expect(result).toBe('您已经举报过该小喇叭，请等待站方处理')
    expect(mocks.prisma.patch_report.create).not.toHaveBeenCalled()
    expect(mocks.prisma.user.findMany).not.toHaveBeenCalled()
  })

  it('rejects a not-yet-effective official message', async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([
      message({
        official: true,
        effective_from: new Date(now.getTime() + 1_000),
        effective_to: new Date(now.getTime() + 86_400_000)
      })
    ])

    const result = await createShoutboxReport(reportInput, 8, {
      now,
      db: mocks.prisma as never
    })

    expect(result).toBe('当前小喇叭不接受举报')
    expect(mocks.prisma.patch_report.create).not.toHaveBeenCalled()
  })

  it('hides an ordinary message once three distinct pending reporters arrive', async () => {
    mocks.prisma.patch_report.findMany.mockResolvedValueOnce([
      { id: 20, sender_id: 8 },
      { id: 21, sender_id: 9 }
    ])
    mocks.prisma.patch_report.create.mockResolvedValueOnce({
      id: 30,
      sender_id: 10
    })

    const result = await createShoutboxReport(reportInput, 10, {
      now,
      db: mocks.prisma as never
    })

    expect(result).toEqual({})
    expect(mocks.prisma.shoutbox.updateMany).toHaveBeenCalledWith({
      where: { id: 12, official: false, status: 0 },
      data: { status: 2, hidden_at: now }
    })
    expect(mocks.createMessage).toHaveBeenCalledOnce()
    expect(mocks.invalidateShoutboxCaches).toHaveBeenCalledOnce()
  })

  it('keeps an ordinary message public with only two distinct pending reporters', async () => {
    mocks.prisma.patch_report.findMany.mockResolvedValueOnce([
      { id: 20, sender_id: 8 }
    ])
    mocks.prisma.patch_report.create.mockResolvedValueOnce({
      id: 30,
      sender_id: 10
    })

    const result = await createShoutboxReport(reportInput, 10, {
      now,
      db: mocks.prisma as never
    })

    expect(result).toEqual({})
    expect(mocks.prisma.patch_report.create).toHaveBeenCalledOnce()
    expect(mocks.prisma.shoutbox.updateMany).not.toHaveBeenCalled()
    expect(mocks.createMessage).not.toHaveBeenCalled()
    expect(mocks.invalidateShoutboxCaches).not.toHaveBeenCalled()
  })

  it('notifies every admin after a report commits and isolates recipient failures', async () => {
    mocks.prisma.user.findMany.mockResolvedValueOnce([
      { id: 30 },
      { id: 31 },
      { id: 32 }
    ])
    mocks.createMessage
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('recipient unavailable'))
      .mockResolvedValueOnce({})

    const result = await createShoutboxReport(reportInput, 8, {
      now,
      db: mocks.prisma as never
    })

    expect(result).toEqual({})
    expect(mocks.prisma.user.findMany).toHaveBeenCalledWith({
      where: { role: { gte: 3 } },
      select: { id: true }
    })
    expect(mocks.createMessage).toHaveBeenCalledTimes(3)
    expect(mocks.createMessage.mock.calls).toEqual(
      expect.arrayContaining([
        [
          {
            type: 'system',
            content: '用户举报了小喇叭 #12，请前往后台处理。',
            sender_id: 8,
            recipient_id: 30,
            link: '/dashboard/shoutbox?shoutbox=12'
          },
          mocks.prisma
        ],
        [
          {
            type: 'system',
            content: '用户举报了小喇叭 #12，请前往后台处理。',
            sender_id: 8,
            recipient_id: 31,
            link: '/dashboard/shoutbox?shoutbox=12'
          },
          mocks.prisma
        ],
        [
          {
            type: 'system',
            content: '用户举报了小喇叭 #12，请前往后台处理。',
            sender_id: 8,
            recipient_id: 32,
            link: '/dashboard/shoutbox?shoutbox=12'
          },
          mocks.prisma
        ]
      ])
    )
  })

  it('keeps a committed report successful when the admin lookup fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mocks.prisma.user.findMany.mockRejectedValueOnce(
        new Error('admin lookup unavailable')
      )

      const result = await createShoutboxReport(reportInput, 8, {
        now,
        db: mocks.prisma as never
      })

      expect(result).toEqual({})
      expect(mocks.prisma.patch_report.create).toHaveBeenCalledOnce()
      expect(mocks.createMessage).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('keeps official messages public when reports reach the threshold', async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([
      message({ official: true, level: 'important', effective_from: now })
    ])
    mocks.prisma.patch_report.findMany.mockResolvedValueOnce([
      { id: 20, sender_id: 8 },
      { id: 21, sender_id: 9 },
      { id: 30, sender_id: 10 }
    ])
    mocks.prisma.user.findUnique.mockResolvedValueOnce({ role: 3 })

    const result = await createShoutboxReport(reportInput, 10, {
      now,
      db: mocks.prisma as never
    })

    expect(result).toEqual({})
    expect(mocks.prisma.patch_report.create).toHaveBeenCalledOnce()
    expect(mocks.prisma.shoutbox.updateMany).not.toHaveBeenCalled()
    expect(mocks.invalidateShoutboxCaches).not.toHaveBeenCalled()
  })

  it('accepts an additional report for a hidden ordinary message without hiding twice', async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([
      message({ status: 2, hidden_at: new Date('2026-09-12T03:00:00.000Z') })
    ])
    mocks.prisma.patch_report.findMany.mockResolvedValueOnce([
      { id: 20, sender_id: 8 },
      { id: 30, sender_id: 10 }
    ])

    const result = await createShoutboxReport(reportInput, 11, {
      now,
      db: mocks.prisma as never
    })

    expect(result).toEqual({})
    expect(mocks.prisma.patch_report.create).toHaveBeenCalledOnce()
    expect(mocks.prisma.shoutbox.updateMany).not.toHaveBeenCalled()
    expect(mocks.createMessage).not.toHaveBeenCalled()
    expect(mocks.invalidateShoutboxCaches).not.toHaveBeenCalled()
  })

  it('removes a reported message and resolves reports without refunding', async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([message()])
    mocks.prisma.patch_report.findMany.mockResolvedValueOnce([
      { id: 20, sender_id: 8, reason: '违规' }
    ])
    const input = adminShoutboxModerateSchema.parse({
      shoutboxId: 12,
      action: 'remove'
    })

    await moderateShoutbox(input, 99, {
      now,
      db: mocks.prisma as never,
      adminRole: 3
    })

    expect(mocks.prisma.shoutbox.updateMany).toHaveBeenCalledWith({
      where: { id: 12, official: false, status: { in: [0, 2] } },
      data: { status: 3 }
    })
    expect(mocks.prisma.patch_report.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { target_type: 'shoutbox', shoutbox_id: 12, status: 0 },
        data: expect.objectContaining({ status: 2, handler_id: 99 })
      })
    )
    expect(mocks.refundMoemoepoint).not.toHaveBeenCalled()
    expect(mocks.prisma.admin_log.create).toHaveBeenCalledOnce()
    expect(mocks.invalidateShoutboxCaches).toHaveBeenCalledOnce()
  })

  it('hides without closing reports and only notifies the author', async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([message()])

    await moderateShoutbox(
      adminShoutboxModerateSchema.parse({ shoutboxId: 12, action: 'hide' }),
      99,
      { now, db: mocks.prisma as never, adminRole: 3 }
    )

    expect(mocks.prisma.shoutbox.updateMany).toHaveBeenCalledWith({
      where: { id: 12, official: false, status: { in: [0] } },
      data: { status: 2, hidden_at: now }
    })
    expect(mocks.prisma.patch_report.updateMany).not.toHaveBeenCalled()
    expect(mocks.createMessage).toHaveBeenCalledOnce()
    expect(mocks.createMessage.mock.calls[0][0].recipient_id).toBe(7)
    expect(mocks.prisma.admin_log.create).toHaveBeenCalledOnce()
  })

  it('resolves an official report without changing the message or notifying its author', async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([
      message({
        official: true,
        effective_from: new Date(now.getTime() - 1_000),
        effective_to: new Date(now.getTime() + 86_400_000)
      })
    ])
    mocks.prisma.patch_report.findMany.mockResolvedValueOnce([
      { id: 20, sender_id: 8, reason: '官方举报' }
    ])
    const input = adminShoutboxModerateSchema.parse({
      shoutboxId: 12,
      action: 'resolve',
      resolution: 'reject',
      content: '已核实'
    })

    await moderateShoutbox(input, 99, {
      now,
      db: mocks.prisma as never,
      adminRole: 3
    })

    expect(mocks.prisma.shoutbox.updateMany).not.toHaveBeenCalled()
    expect(mocks.createMessage).toHaveBeenCalledOnce()
    expect(mocks.createMessage.mock.calls[0][0].recipient_id).toBe(8)
    expect(mocks.prisma.admin_log.create).toHaveBeenCalledOnce()
    expect(mocks.invalidateShoutboxCaches).toHaveBeenCalledOnce()
  })

  it.each(['hide', 'remove', 'restore'] as const)(
    'rejects %s for an official message',
    async (action) => {
      mocks.prisma.$queryRaw.mockResolvedValueOnce([
        message({
          official: true,
          effective_from: new Date(now.getTime() - 1_000),
          effective_to: new Date(now.getTime() + 86_400_000)
        })
      ])

      const result = await moderateShoutbox(
        adminShoutboxModerateSchema.parse({ shoutboxId: 12, action }),
        99,
        { now, db: mocks.prisma as never, adminRole: 3 }
      )

      expect(result).toBe('官方小喇叭只能结案，不能执行该处置')
      expect(mocks.prisma.shoutbox.updateMany).not.toHaveBeenCalled()
      expect(mocks.prisma.admin_log.create).not.toHaveBeenCalled()
      expect(mocks.invalidateShoutboxCaches).not.toHaveBeenCalled()
    }
  )

  it('rejects resolve for a hidden message so it cannot disappear from review', async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([
      message({ status: 2, hidden_at: new Date('2026-09-12T03:00:00.000Z') })
    ])

    const result = await moderateShoutbox(
      adminShoutboxModerateSchema.parse({
        shoutboxId: 12,
        action: 'resolve',
        resolution: 'accept'
      }),
      99,
      { now, db: mocks.prisma as never, adminRole: 3 }
    )

    expect(result).toBe('隐藏中的小喇叭必须删除或恢复')
    expect(mocks.prisma.patch_report.updateMany).not.toHaveBeenCalled()
    expect(mocks.prisma.admin_log.create).not.toHaveBeenCalled()
  })

  it('resolves a self-deleted message but cannot restore it or refund it', async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([message({ status: 1 })])
    mocks.prisma.patch_report.findMany.mockResolvedValueOnce([
      { id: 20, sender_id: 8, reason: '自删前举报' }
    ])

    const resolved = await moderateShoutbox(
      adminShoutboxModerateSchema.parse({
        shoutboxId: 12,
        action: 'resolve',
        resolution: 'reject'
      }),
      99,
      { now, db: mocks.prisma as never, adminRole: 3 }
    )

    expect(resolved).toEqual({})
    expect(mocks.createMessage).toHaveBeenCalledTimes(2)
    expect(mocks.refundMoemoepoint).not.toHaveBeenCalled()

    vi.clearAllMocks()
    mocks.prisma.$transaction.mockImplementation(async (callback) =>
      callback(mocks.prisma)
    )
    mocks.prisma.$queryRaw.mockResolvedValueOnce([message({ status: 1 })])
    mocks.prisma.shoutbox.updateMany.mockResolvedValueOnce({ count: 0 })
    const restored = await moderateShoutbox(
      adminShoutboxModerateSchema.parse({ shoutboxId: 12, action: 'restore' }),
      99,
      { now, db: mocks.prisma as never, adminRole: 3 }
    )

    expect(restored).toBe('当前小喇叭不能恢复')
    expect(mocks.refundMoemoepoint).not.toHaveBeenCalled()
  })

  it('restores a hidden message and refunds its cost at most once', async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([
      message({ status: 2, hidden_at: new Date('2026-09-12T03:00:00.000Z') })
    ])
    mocks.prisma.patch_report.findMany.mockResolvedValueOnce([
      { id: 20, sender_id: 8, reason: '违规' }
    ])
    const input = adminShoutboxModerateSchema.parse({
      shoutboxId: 12,
      action: 'restore'
    })

    await moderateShoutbox(input, 99, {
      now,
      db: mocks.prisma as never,
      adminRole: 3
    })

    expect(mocks.refundMoemoepoint).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({
        userId: 7,
        amount: 50,
        idempotencyKey: 'shoutbox:12:restore-refund'
      })
    )
    expect(mocks.prisma.shoutbox.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 12, official: false, status: { in: [2, 3] } },
      data: { status: 0, hidden_at: null }
    })
    expect(mocks.prisma.shoutbox.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 12, status: 0, refunded_at: null },
      data: { refunded_at: now }
    })
    expect(mocks.prisma.patch_report.updateMany).toHaveBeenCalledWith({
      where: { target_type: 'shoutbox', shoutbox_id: 12, status: 0 },
      data: {
        status: 3,
        handler_id: 99,
        handler_reply: '举报已驳回',
        handled_at: now
      }
    })
    expect(mocks.createMessage).toHaveBeenCalledTimes(2)
    expect(
      mocks.createMessage.mock.calls
        .map((call) => call[0].recipient_id)
        .sort((a, b) => a - b)
    ).toEqual([7, 8])
    expect(
      mocks.createMessage.mock.calls.every((call) => call[1] === mocks.prisma)
    ).toBe(true)
  })

  it('restores a terminated message that was already refunded without refunding again', async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([
      message({
        status: 3,
        refunded_at: new Date('2026-09-12T03:30:00.000Z')
      })
    ])

    const result = await moderateShoutbox(
      adminShoutboxModerateSchema.parse({ shoutboxId: 12, action: 'restore' }),
      99,
      { now, db: mocks.prisma as never, adminRole: 3 }
    )

    expect(result).toEqual({})
    expect(mocks.refundMoemoepoint).not.toHaveBeenCalled()
    expect(mocks.prisma.shoutbox.updateMany).toHaveBeenCalledWith({
      where: { id: 12, official: false, status: { in: [2, 3] } },
      data: { status: 0, hidden_at: null }
    })
    expect(mocks.invalidateShoutboxCaches).toHaveBeenCalledOnce()
  })

  it.each([
    ['hide', 0, '当前小喇叭不能隐藏'],
    ['remove', 0, '当前小喇叭不能删除'],
    ['restore', 2, '当前小喇叭不能恢复']
  ] as const)(
    'does not notify or audit when the %s CAS loses',
    async (action, status, error) => {
      mocks.prisma.$queryRaw.mockResolvedValueOnce([message({ status })])
      mocks.prisma.shoutbox.updateMany.mockResolvedValueOnce({ count: 0 })

      const result = await moderateShoutbox(
        adminShoutboxModerateSchema.parse({ shoutboxId: 12, action }),
        99,
        { now, db: mocks.prisma as never, adminRole: 3 }
      )

      expect(result).toBe(error)
      expect(mocks.prisma.patch_report.updateMany).not.toHaveBeenCalled()
      expect(mocks.createMessage).not.toHaveBeenCalled()
      expect(mocks.prisma.admin_log.create).not.toHaveBeenCalled()
      expect(mocks.invalidateShoutboxCaches).not.toHaveBeenCalled()
    }
  )

  it('leaves a resolve with no pending reports as an audit and notification no-op', async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([message()])

    const result = await moderateShoutbox(
      adminShoutboxModerateSchema.parse({
        shoutboxId: 12,
        action: 'resolve',
        resolution: 'accept'
      }),
      99,
      { now, db: mocks.prisma as never, adminRole: 3 }
    )

    expect(result).toEqual({})
    expect(mocks.prisma.patch_report.updateMany).not.toHaveBeenCalled()
    expect(mocks.createMessage).not.toHaveBeenCalled()
    expect(mocks.prisma.admin_log.create).not.toHaveBeenCalled()
    expect(mocks.invalidateShoutboxCaches).not.toHaveBeenCalled()
  })

  it('rejects low-role service calls before opening a transaction', async () => {
    const result = await moderateShoutbox(
      adminShoutboxModerateSchema.parse({ shoutboxId: 12, action: 'remove' }),
      99,
      { now, db: mocks.prisma as never, adminRole: 2 }
    )

    expect(result).toBe('本页面仅管理员可访问')
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('checks the keyword before any database or accounting access', async () => {
    const parsed = shoutboxReportSchema.parse(reportInput)
    expect(parsed).toEqual(reportInput)
    const result = await (
      await import('~/app/api/shoutbox/service')
    ).createShoutbox(
      {
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        content: 'bad word'
      },
      7,
      { db: mocks.prisma as never, keywords: ['bad'] }
    )
    expect(result).toBe('正文包含不允许的关键词')
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    expect(mocks.prisma.shoutbox.findUnique).not.toHaveBeenCalled()
    expect(mocks.spendMoemoepoint).not.toHaveBeenCalled()
  })

  it('checks the same injected keyword list before an edit write', async () => {
    const { updateShoutbox } = await import('~/app/api/shoutbox/service')
    const result = await updateShoutbox(
      { shoutboxId: 12, content: 'bad word' },
      7,
      { db: mocks.prisma as never, keywords: ['bad'] }
    )

    expect(result).toBe('正文包含不允许的关键词')
    expect(mocks.prisma.shoutbox.updateMany).not.toHaveBeenCalled()
  })
})
