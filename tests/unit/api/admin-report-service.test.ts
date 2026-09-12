import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    patch_report: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn()
    },
    patch_rating: { deleteMany: vi.fn() },
    patch_comment: { deleteMany: vi.fn() },
    user_message: { createMany: vi.fn() },
    $transaction: vi.fn()
  },
  recomputePatchRatingStat: vi.fn(),
  invalidatePatchContentCache: vi.fn(),
  invalidatePatchListCaches: vi.fn()
}))

vi.mock('~/prisma/index', () => ({ prisma: mocks.prisma }))
vi.mock('~/app/api/patch/rating/stat', () => ({
  recomputePatchRatingStat: mocks.recomputePatchRatingStat
}))
vi.mock('~/app/api/patch/cache', () => ({
  invalidatePatchContentCache: mocks.invalidatePatchContentCache,
  invalidatePatchListCaches: mocks.invalidatePatchListCaches
}))

import { getReport, handleReport } from '~/app/api/admin/report/service'

const user = { id: 2, name: '用户', avatar: '/avatar.png' }
const patch = { id: 4, unique_id: 'moon', name: '月光' }
const legacyReport = (overrides: Record<string, unknown> = {}) => ({
  id: 5,
  target_type: 'comment',
  status: 0,
  reason: '有问题',
  handler_reply: '',
  created: new Date('2026-09-01T00:00:00.000Z'),
  handled_at: null,
  sender: user,
  reported_user: { ...user, id: 9 },
  patch,
  comment: { id: 10, content: '评论' },
  rating: null,
  comment_id: 10,
  rating_id: null,
  patch_id: 4,
  ...overrides
})
const shoutboxReport = (overrides: Record<string, unknown> = {}) =>
  legacyReport({
    target_type: 'shoutbox',
    patch: null,
    patch_id: null,
    comment_id: null,
    rating_id: null,
    comment: null,
    rating: null,
    shoutbox: {
      id: 12,
      content: '小喇叭正文',
      official: false,
      level: 'normal',
      status: 0,
      cost: 50,
      created: new Date('2026-09-01T00:00:00.000Z'),
      hidden_at: null,
      refunded_at: null,
      patch: null
    },
    ...overrides
  })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.prisma.$transaction.mockImplementation(async (callback) =>
    callback(mocks.prisma)
  )
})

describe('legacy admin report compatibility', () => {
  it('uses a non-null patch predicate for both rows and total', async () => {
    mocks.prisma.patch_report.findMany.mockResolvedValue([
      legacyReport(),
      legacyReport({ id: 6, patch: null, patch_id: null })
    ])
    mocks.prisma.patch_report.count.mockResolvedValue(1)

    const result = await getReport({
      page: 1,
      limit: 30,
      tab: 'pending',
      targetType: 'comment'
    })

    expect(result.reports).toHaveLength(1)
    expect(result.total).toBe(1)
    const expectedWhere = {
      target_type: 'comment',
      patch_id: { not: null },
      status: 0
    }
    expect(mocks.prisma.patch_report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere })
    )
    expect(mocks.prisma.patch_report.count).toHaveBeenCalledWith({
      where: expectedWhere
    })
  })

  it('reads and serializes shoutbox reports with a nullable patch', async () => {
    mocks.prisma.patch_report.findMany.mockResolvedValue([shoutboxReport()])
    mocks.prisma.patch_report.count.mockResolvedValue(1)

    const result = await getReport({
      page: 1,
      limit: 30,
      tab: 'pending',
      targetType: 'shoutbox'
    })

    expect(result.reports).toEqual([
      expect.objectContaining({
        id: 5,
        targetType: 'shoutbox',
        patch: null,
        shoutbox: expect.objectContaining({
          id: 12,
          content: '小喇叭正文',
          cost: 50
        }),
        comment: null,
        rating: null
      })
    ])
    const expectedWhere = {
      target_type: 'shoutbox',
      shoutbox_id: { not: null },
      status: 0
    }
    expect(mocks.prisma.patch_report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere })
    )
    expect(mocks.prisma.patch_report.count).toHaveBeenCalledWith({
      where: expectedWhere
    })
  })

  it('routes shoutbox reports to the dedicated review page', async () => {
    mocks.prisma.patch_report.findUnique.mockResolvedValue(
      legacyReport({ target_type: 'shoutbox', patch: null, patch_id: null })
    )

    await expect(
      handleReport({ reportId: 5, action: 'delete', content: '' }, 99)
    ).resolves.toBe('请在控制台小喇叭复核页处理')
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('reports missing patch data for a legacy comment instead of throwing', async () => {
    mocks.prisma.patch_report.findUnique.mockResolvedValue(
      legacyReport({ patch: null, patch_id: null })
    )

    await expect(
      handleReport({ reportId: 5, action: 'delete', content: '' }, 99)
    ).resolves.toBe('该举报缺少条目信息，数据异常')
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })
})
