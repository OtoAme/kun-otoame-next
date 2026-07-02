import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => {
  const tx = {
    patch_rating_like: {
      create: vi.fn(),
      delete: vi.fn()
    },
    user: {
      update: vi.fn()
    },
    user_patch_comment_like_relation: {
      create: vi.fn(),
      delete: vi.fn()
    },
    user_patch_favorite_folder_relation: {
      create: vi.fn(),
      delete: vi.fn()
    },
    user_patch_resource_like_relation: {
      create: vi.fn(),
      delete: vi.fn()
    }
  }

  return {
    patch: {
      findUnique: vi.fn()
    },
    patch_comment: {
      findUnique: vi.fn()
    },
    patch_rating: {
      findUnique: vi.fn()
    },
    patch_rating_like: {
      findUnique: vi.fn()
    },
    patch_resource: {
      findUnique: vi.fn()
    },
    user_patch_comment_like_relation: {
      findUnique: vi.fn()
    },
    user_patch_favorite_folder: {
      findUnique: vi.fn()
    },
    user_patch_favorite_folder_relation: {
      findUnique: vi.fn()
    },
    user_patch_resource_like_relation: {
      findUnique: vi.fn()
    },
    $transaction: vi.fn((fn: (transaction: typeof tx) => unknown) => fn(tx)),
    _tx: tx
  }
})

vi.mock('~/prisma/index', () => ({
  prisma: prismaMock
}))

const createDedupMessageMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/utils/message', () => ({
  createDedupMessage: createDedupMessageMock
}))

vi.mock('~/app/api/patch/cache', () => ({
  invalidatePatchContentCache: vi.fn(),
  invalidatePatchListCaches: vi.fn(),
  setCachedPatchFavoriteStatus: vi.fn()
}))

describe('user-triggered notification anti-abuse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation((fn) => fn(prismaMock._tx))
  })

  it('does not create a favorite notification when removing an existing favorite', async () => {
    prismaMock.patch.findUnique.mockResolvedValue({
      id: 10,
      name: '测试作品',
      unique_id: 'abcd1234',
      user_id: 200
    })
    prismaMock.user_patch_favorite_folder.findUnique.mockResolvedValue({
      id: 20,
      user_id: 100
    })
    prismaMock.user_patch_favorite_folder_relation.findUnique.mockResolvedValue(
      { id: 30 }
    )

    const { togglePatchFavorite } = await import(
      '~/app/api/patch/favorite/service'
    )

    await expect(
      togglePatchFavorite({ patchId: 10, folderId: 20 }, 100)
    ).resolves.toEqual({ added: false })

    expect(createDedupMessageMock).not.toHaveBeenCalled()
    expect(
      prismaMock._tx.user_patch_favorite_folder_relation.delete
    ).toHaveBeenCalled()
  })

  it('does not create a comment-like notification when unliking a comment', async () => {
    prismaMock.patch_comment.findUnique.mockResolvedValue({
      id: 10,
      user_id: 200,
      content: '评论内容',
      patch: { unique_id: 'abcd1234' }
    })
    prismaMock.user_patch_comment_like_relation.findUnique.mockResolvedValue({
      id: 30
    })

    const { toggleCommentLike } = await import(
      '~/app/api/patch/comment/like/service'
    )

    await expect(toggleCommentLike({ commentId: 10 }, 100)).resolves.toBe(false)

    expect(createDedupMessageMock).not.toHaveBeenCalled()
    expect(
      prismaMock._tx.user_patch_comment_like_relation.delete
    ).toHaveBeenCalled()
  })

  it('does not create a rating-like notification when unliking a rating', async () => {
    prismaMock.patch_rating.findUnique.mockResolvedValue({
      id: 10,
      user_id: 200,
      short_summary: '评价摘要',
      patch: { unique_id: 'abcd1234', name: '测试作品' }
    })
    prismaMock.patch_rating_like.findUnique.mockResolvedValue({ id: 30 })

    const { toggleRatingLike } = await import(
      '~/app/api/patch/rating/like/service'
    )

    await expect(toggleRatingLike({ ratingId: 10 }, 100)).resolves.toBe(false)

    expect(createDedupMessageMock).not.toHaveBeenCalled()
    expect(prismaMock._tx.patch_rating_like.delete).toHaveBeenCalled()
  })

  it('does not create a resource-like notification when unliking a resource', async () => {
    prismaMock.patch_resource.findUnique.mockResolvedValue({
      id: 10,
      user_id: 200,
      patch: { unique_id: 'abcd1234', name: '测试作品' }
    })
    prismaMock.user_patch_resource_like_relation.findUnique.mockResolvedValue({
      id: 30
    })

    const { toggleResourceLike } = await import(
      '~/app/api/patch/resource/like/service'
    )

    await expect(toggleResourceLike({ resourceId: 10 }, 100)).resolves.toBe(
      false
    )

    expect(createDedupMessageMock).not.toHaveBeenCalled()
    expect(
      prismaMock._tx.user_patch_resource_like_relation.delete
    ).toHaveBeenCalled()
  })
})
