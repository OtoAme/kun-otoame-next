import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => ({
  user: { count: vi.fn() },
  patch: { count: vi.fn() },
  patch_resource: { count: vi.fn() },
  patch_comment: { count: vi.fn() },
  patch_rating: { count: vi.fn() },
  patch_submission: { count: vi.fn() },
  user_message: { count: vi.fn() }
}))

vi.mock('~/prisma/index', () => ({ prisma: prismaMocks }))

import { getSumData } from '~/app/api/admin/stats/sum/service'

beforeEach(() => {
  vi.resetAllMocks()
  prismaMocks.user.count.mockImplementation((args?: { where?: unknown }) =>
    Promise.resolve(args?.where ? 37 : 101)
  )
  prismaMocks.patch.count.mockResolvedValue(23)
  prismaMocks.patch_resource.count
    .mockResolvedValueOnce(17)
    .mockResolvedValueOnce(6)
  prismaMocks.patch_comment.count.mockResolvedValue(41)
  prismaMocks.patch_rating.count.mockResolvedValue(53)
  prismaMocks.patch_submission.count.mockResolvedValue(29)
  prismaMocks.user_message.count.mockResolvedValue(11)
})

describe('admin stats sum', () => {
  it('returns legacy totals and the new cumulative counts', async () => {
    await expect(getSumData()).resolves.toEqual({
      userCount: 101,
      galgameCount: 23,
      galgameResourceCount: 17,
      galgamePatchResourceCount: 6,
      galgameCommentCount: 41,
      ratingCount: 53,
      submissionCount: 29,
      creatorCount: 37,
      pendingCreatorApplyCount: 11
    })
  })

  it('uses the exact predicates for creator applications and creator users', async () => {
    await getSumData()

    expect(prismaMocks.user.count).toHaveBeenCalledWith()
    expect(prismaMocks.user.count).toHaveBeenCalledWith({ where: { role: 2 } })
    expect(prismaMocks.patch_rating.count).toHaveBeenCalledWith()
    expect(prismaMocks.patch_submission.count).toHaveBeenCalledWith()
    expect(prismaMocks.user_message.count).toHaveBeenCalledWith({
      where: {
        type: 'apply',
        sender_id: { not: null },
        recipient_id: null,
        status: { in: [0, 1] }
      }
    })
  })

  it('keeps the existing section predicates for resource totals', async () => {
    await getSumData()

    expect(prismaMocks.patch_resource.count).toHaveBeenNthCalledWith(1, {
      where: { section: 'galgame' }
    })
    expect(prismaMocks.patch_resource.count).toHaveBeenNthCalledWith(2, {
      where: { section: 'patch' }
    })
  })
})
