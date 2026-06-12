import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  admin_log: {
    create: vi.fn()
  },
  patch_comment: {
    create: vi.fn(),
    delete: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn()
  },
  patch_rating: {
    create: vi.fn(),
    delete: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn()
  },
  user: {
    findUnique: vi.fn()
  },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(prismaMock)
  )
}))

vi.mock('~/prisma/index', () => ({
  prisma: prismaMock
}))

const cacheMocks = vi.hoisted(() => ({
  invalidatePatchContentCache: vi.fn(),
  invalidatePatchListCaches: vi.fn()
}))

vi.mock('~/app/api/patch/cache', () => cacheMocks)

vi.mock('~/app/api/utils/message', () => ({
  createDedupMessage: vi.fn()
}))

vi.mock('~/app/api/utils/createMentionMessage', () => ({
  createMentionMessage: vi.fn()
}))

vi.mock('~/app/api/utils/render/markdownToHtml', () => ({
  markdownToHtml: vi.fn(async (markdown: string) => markdown)
}))

const recomputePatchRatingStatMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/patch/rating/stat', () => ({
  recomputePatchRatingStat: recomputePatchRatingStatMock
}))

import { createPatchComment } from '~/app/api/patch/comment/create'
import { deleteComment } from '~/app/api/patch/comment/delete'
import { updateComment } from '~/app/api/patch/comment/update'
import { createPatchRating } from '~/app/api/patch/rating/create'
import { deletePatchRating } from '~/app/api/patch/rating/delete'
import { updatePatchRating } from '~/app/api/patch/rating/update'
import { updateComment as adminUpdateComment } from '~/app/api/admin/comment/update'
import { updateRating as adminUpdateRating } from '~/app/api/admin/rating/update'

describe('patch social cache invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cacheMocks.invalidatePatchContentCache.mockResolvedValue(undefined)
    cacheMocks.invalidatePatchListCaches.mockResolvedValue(undefined)
    recomputePatchRatingStatMock.mockResolvedValue(undefined)
    prismaMock.$transaction.mockImplementation(async (fn) => fn(prismaMock))
    prismaMock.user.findUnique.mockResolvedValue({ id: 9, name: 'Admin' })
    prismaMock.admin_log.create.mockResolvedValue({})
  })

  it('invalidates patch caches after creating a comment', async () => {
    prismaMock.patch_comment.create.mockResolvedValue({
      id: 11,
      content: 'comment',
      parent_id: null,
      user_id: 2,
      patch_id: 7,
      created: new Date('2026-01-01T00:00:00Z'),
      updated: new Date('2026-01-01T00:00:00Z'),
      patch: {
        name: 'Otome',
        unique_id: 'abc12345'
      },
      user: {
        name: 'Alice'
      }
    })

    await createPatchComment(
      { patchId: 7, parentId: null, content: 'comment' },
      2
    )

    expect(cacheMocks.invalidatePatchContentCache).toHaveBeenCalledWith(
      'abc12345'
    )
    expect(cacheMocks.invalidatePatchListCaches).toHaveBeenCalled()
  })

  it('invalidates patch caches after updating a comment', async () => {
    prismaMock.patch_comment.findUnique.mockResolvedValue({
      id: 11,
      user_id: 2,
      patch: {
        unique_id: 'abc12345'
      }
    })
    prismaMock.patch_comment.update.mockResolvedValue({})

    await updateComment({ commentId: 11, content: 'updated' }, 2, 1)

    expect(cacheMocks.invalidatePatchContentCache).toHaveBeenCalledWith(
      'abc12345'
    )
  })

  it('invalidates patch caches after deleting a comment tree', async () => {
    prismaMock.patch_comment.findUnique.mockResolvedValue({
      id: 11,
      user_id: 2,
      patch_id: 7,
      patch: {
        unique_id: 'abc12345'
      }
    })
    prismaMock.patch_comment.findMany.mockResolvedValue([])
    prismaMock.patch_comment.delete.mockResolvedValue({})

    await deleteComment({ commentId: 11 }, 2, 1)

    expect(cacheMocks.invalidatePatchContentCache).toHaveBeenCalledWith(
      'abc12345'
    )
    expect(cacheMocks.invalidatePatchListCaches).toHaveBeenCalled()
  })

  it('invalidates patch caches after creating a rating', async () => {
    prismaMock.patch_rating.findUnique.mockResolvedValue(null)
    prismaMock.patch_rating.create.mockResolvedValue({
      id: 5,
      patch_id: 7,
      user_id: 2,
      recommend: 'yes',
      overall: 8,
      play_status: 'played',
      short_summary: 'good',
      spoiler_level: 'none',
      created: new Date('2026-01-01T00:00:00Z'),
      updated: new Date('2026-01-01T00:00:00Z'),
      patch: {
        unique_id: 'abc12345'
      },
      user: {
        id: 2,
        name: 'Alice',
        avatar: ''
      }
    })

    await createPatchRating(
      {
        patchId: 7,
        recommend: 'yes',
        overall: 8,
        playStatus: 'played',
        shortSummary: 'good',
        spoilerLevel: 'none'
      },
      2
    )

    expect(cacheMocks.invalidatePatchContentCache).toHaveBeenCalledWith(
      'abc12345'
    )
    expect(cacheMocks.invalidatePatchListCaches).toHaveBeenCalled()
  })

  it('invalidates patch caches after updating a rating', async () => {
    prismaMock.patch_rating.findUnique.mockResolvedValue({
      id: 5,
      patch_id: 7,
      user_id: 2
    })
    prismaMock.patch_rating.update.mockResolvedValue({
      id: 5,
      patch_id: 7,
      user_id: 2,
      recommend: 'yes',
      overall: 9,
      play_status: 'played',
      short_summary: 'better',
      spoiler_level: 'none',
      created: new Date('2026-01-01T00:00:00Z'),
      updated: new Date('2026-01-01T00:00:00Z'),
      patch: {
        unique_id: 'abc12345'
      },
      user: {
        id: 2,
        name: 'Alice',
        avatar: ''
      },
      _count: {
        like: 0
      },
      like: []
    })

    await updatePatchRating(
      {
        ratingId: 5,
        patchId: 7,
        recommend: 'yes',
        overall: 9,
        playStatus: 'played',
        shortSummary: 'better',
        spoilerLevel: 'none'
      },
      2,
      1
    )

    expect(cacheMocks.invalidatePatchContentCache).toHaveBeenCalledWith(
      'abc12345'
    )
    expect(cacheMocks.invalidatePatchListCaches).toHaveBeenCalled()
  })

  it('invalidates patch caches after deleting a rating', async () => {
    prismaMock.patch_rating.findUnique.mockResolvedValue({
      id: 5,
      patch_id: 7,
      user_id: 2,
      patch: {
        unique_id: 'abc12345'
      }
    })
    prismaMock.patch_rating.delete.mockResolvedValue({})

    await deletePatchRating({ ratingId: 5 }, 2, 1)

    expect(cacheMocks.invalidatePatchContentCache).toHaveBeenCalledWith(
      'abc12345'
    )
    expect(cacheMocks.invalidatePatchListCaches).toHaveBeenCalled()
  })

  it('invalidates patch content cache after an admin updates a comment', async () => {
    prismaMock.patch_comment.findUnique.mockResolvedValue({
      id: 11,
      content: 'old comment',
      patch: {
        unique_id: 'abc12345'
      }
    })
    prismaMock.patch_comment.update.mockResolvedValue({})

    await adminUpdateComment({ commentId: 11, content: 'admin edit' }, 9)

    expect(cacheMocks.invalidatePatchContentCache).toHaveBeenCalledWith(
      'abc12345'
    )
  })

  it('invalidates patch content cache after an admin updates a rating summary', async () => {
    prismaMock.patch_rating.findUnique.mockResolvedValue({
      id: 5,
      short_summary: 'old summary',
      patch: {
        unique_id: 'abc12345'
      }
    })
    prismaMock.patch_rating.update.mockResolvedValue({})

    await adminUpdateRating({ ratingId: 5, shortSummary: 'admin edit' }, 9)

    expect(cacheMocks.invalidatePatchContentCache).toHaveBeenCalledWith(
      'abc12345'
    )
  })
})
