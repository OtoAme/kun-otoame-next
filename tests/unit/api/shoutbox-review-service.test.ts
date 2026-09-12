import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    shoutbox: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    patch_report: { findMany: vi.fn() },
    $queryRaw: vi.fn()
  }
}))

vi.mock('~/prisma/index', () => ({ prisma: mocks.prisma }))
vi.mock('~/app/api/shoutbox/cache', () => ({
  invalidateShoutboxCaches: vi.fn(),
  getShoutboxCached: vi.fn(),
  getShoutboxCacheKey: vi.fn(),
  getShoutboxBannerCached: vi.fn(),
  getShoutboxBannerCacheKey: vi.fn(),
  SHOUTBOX_LIST_CACHE_DURATION: 60,
  SHOUTBOX_BANNER_CACHE_DURATION: 60,
  SHOUTBOX_PATCH_CACHE_DURATION: 300
}))
vi.mock('~/app/api/utils/message', () => ({ createMessage: vi.fn() }))
vi.mock('~/app/api/moemoepoint/service', () => ({
  MoemoepointInsufficientError: class extends Error {},
  getCurrentBalance: vi.fn(),
  refundMoemoepoint: vi.fn(),
  spendMoemoepoint: vi.fn()
}))

import {
  getAdminOfficialShoutboxes,
  getAdminShoutboxList
} from '~/app/api/shoutbox/service'

const user = { id: 7, name: '作者', avatar: '', role: 1 }
const row = (id: number) => ({
  id,
  user_id: 7,
  request_id: `request-${id}`,
  content: `正文 ${id}`,
  link: '',
  official: false,
  level: 'normal',
  status: id === 1 ? 2 : 0,
  cost: 50,
  patch_id: null,
  effective_from: null,
  effective_to: null,
  edited_at: null,
  hidden_at: id === 1 ? new Date('2026-09-12T00:00:00.000Z') : null,
  refunded_at: null,
  created: new Date(`2026-09-0${id}T00:00:00.000Z`),
  updated: new Date(`2026-09-0${id}T00:00:00.000Z`),
  user,
  patch: null
})

beforeEach(() => {
  vi.resetAllMocks()
  mocks.prisma.shoutbox.count.mockResolvedValue(2)
  mocks.prisma.$queryRaw.mockResolvedValue([{ id: 1 }, { id: 2 }])
  mocks.prisma.shoutbox.findMany.mockResolvedValue([row(2), row(1)])
  mocks.prisma.patch_report.findMany.mockResolvedValue([
    {
      id: 31,
      shoutbox_id: 1,
      reason: '第一条举报',
      created: new Date('2026-09-12T01:00:00.000Z'),
      sender: { id: 8, name: '举报人', avatar: '' }
    }
  ])
})

describe('admin shoutbox review evidence', () => {
  it('keeps oldest review order and returns pending report evidence', async () => {
    const result = await getAdminShoutboxList(
      {
        page: 1,
        limit: 20,
        tab: 'pending_review'
      },
      { db: mocks.prisma as never, adminRole: 3 }
    )
    if (typeof result === 'string') {
      throw new Error(result)
    }

    const reviewQuery = mocks.prisma.$queryRaw.mock.calls[0][0]
    expect(reviewQuery.text).toContain(
      'ORDER BY COALESCE(MIN(r.created), s.hidden_at) ASC NULLS LAST'
    )
    expect(reviewQuery.text).toContain('s.id ASC')
    expect(reviewQuery.text).not.toContain('MIN(r.created) ASC NULLS LAST,')
    expect(result).toMatchObject({ page: 1, totalPages: 1 })
    expect(result.shoutboxes.map((item) => item.id)).toEqual([1, 2])
    expect(result.shoutboxes[0]).toMatchObject({
      pendingReports: [
        {
          id: 31,
          reason: '第一条举报',
          sender: { id: 8, name: '举报人' }
        }
      ]
    })
    expect(result.shoutboxes[1]).toMatchObject({ pendingReports: [] })
  })

  it('returns an empty pending page when the ordered ID query has no rows', async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([])

    const result = await getAdminShoutboxList(
      { page: 1, limit: 20, tab: 'pending_review' },
      { db: mocks.prisma as never, adminRole: 3 }
    )
    if (typeof result === 'string') {
      throw new Error(result)
    }

    expect(result.shoutboxes).toEqual([])
    expect(mocks.prisma.shoutbox.findMany).not.toHaveBeenCalled()
  })

  it('keeps official withdrawals out of the ordinary removed tab', async () => {
    mocks.prisma.shoutbox.count.mockResolvedValueOnce(0)

    const result = await getAdminShoutboxList(
      { page: 1, limit: 20, tab: 'removed' },
      { db: mocks.prisma as never, adminRole: 3 }
    )
    if (typeof result === 'string') {
      throw new Error(result)
    }

    expect(result.shoutboxes).toEqual([])
    expect(mocks.prisma.shoutbox.count).toHaveBeenCalledWith({
      where: { official: false, status: { in: [1, 3] } }
    })
  })

  it('locates a target by ID across tabs and includes its pending reports', async () => {
    mocks.prisma.shoutbox.findUnique.mockResolvedValueOnce(row(1))

    const result = await getAdminShoutboxList(
      {
        page: 7,
        limit: 20,
        tab: 'official',
        shoutboxId: 1
      },
      { db: mocks.prisma as never, adminRole: 3 }
    )
    if (typeof result === 'string') {
      throw new Error(result)
    }

    expect(result).toMatchObject({ page: 1, totalPages: 1 })
    expect(result.shoutboxes).toHaveLength(1)
    expect(result.shoutboxes[0]).toMatchObject({
      id: 1,
      pendingReports: [
        {
          id: 31,
          reason: '第一条举报',
          sender: { id: 8, name: '举报人' }
        }
      ]
    })
    expect(mocks.prisma.shoutbox.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 } })
    )
    expect(mocks.prisma.shoutbox.count).not.toHaveBeenCalled()
    expect(mocks.prisma.shoutbox.findMany).not.toHaveBeenCalled()
  })

  it('uses the same target lookup when the admin route selects the official tab', async () => {
    mocks.prisma.shoutbox.findUnique.mockResolvedValueOnce(row(1))

    const result = await getAdminOfficialShoutboxes(
      {
        page: 3,
        limit: 20,
        tab: 'official',
        shoutboxId: 1
      },
      { db: mocks.prisma as never, adminRole: 3 }
    )
    if (typeof result === 'string') {
      throw new Error(result)
    }

    expect(result).toMatchObject({ page: 1, totalPages: 1 })
    expect(result.shoutboxes[0]).toMatchObject({
      id: 1,
      pendingReports: expect.any(Array)
    })
    expect(mocks.prisma.shoutbox.count).not.toHaveBeenCalled()
  })
})
