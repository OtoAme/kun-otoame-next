import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const prismaMock = vi.hoisted(() => {
  const tx = {
    patch_rating_like: {
      createMany: vi.fn(),
      deleteMany: vi.fn()
    },
    user_patch_comment_like_relation: {
      createMany: vi.fn(),
      deleteMany: vi.fn()
    },
    user_patch_resource_like_relation: {
      createMany: vi.fn(),
      deleteMany: vi.fn()
    }
  }

  return {
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

const moemoepointMock = vi.hoisted(() => ({
  earnMoemoepoint: vi.fn(),
  reverseMoemoepoint: vi.fn()
}))
vi.mock('~/app/api/moemoepoint/service', () => moemoepointMock)

const LIKER_ID = 100

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test'
  })

interface LikeService {
  name: string
  relation: keyof typeof prismaMock._tx
  seedTarget: () => void
  seedExistingLike: (row: { id: number } | null) => void
  toggle: () => Promise<boolean | string>
}

const seedComment = () => {
  prismaMock.patch_comment.findUnique.mockResolvedValue({
    id: 10,
    user_id: 200,
    content: '评论内容',
    patch: { unique_id: 'abcd1234' }
  })
}

const toggleComment = async () => {
  const { toggleCommentLike } = await import(
    '~/app/api/patch/comment/like/service'
  )
  return toggleCommentLike({ commentId: 10 }, LIKER_ID)
}

const services: LikeService[] = [
  {
    name: 'toggleCommentLike',
    relation: 'user_patch_comment_like_relation',
    seedTarget: seedComment,
    seedExistingLike: (row) => {
      prismaMock.user_patch_comment_like_relation.findUnique.mockResolvedValue(
        row
      )
    },
    toggle: toggleComment
  },
  {
    name: 'toggleRatingLike',
    relation: 'patch_rating_like',
    seedTarget: () => {
      prismaMock.patch_rating.findUnique.mockResolvedValue({
        id: 10,
        user_id: 200,
        short_summary: '评价摘要',
        patch: { unique_id: 'abcd1234', name: '测试作品' }
      })
    },
    seedExistingLike: (row) => {
      prismaMock.patch_rating_like.findUnique.mockResolvedValue(row)
    },
    toggle: async () => {
      const { toggleRatingLike } = await import(
        '~/app/api/patch/rating/like/service'
      )
      return toggleRatingLike({ ratingId: 10 }, LIKER_ID)
    }
  },
  {
    name: 'toggleResourceLike',
    relation: 'user_patch_resource_like_relation',
    seedTarget: () => {
      prismaMock.patch_resource.findUnique.mockResolvedValue({
        id: 10,
        user_id: 200,
        name: '测试资源',
        patch: { unique_id: 'abcd1234', name: '测试作品' }
      })
    },
    seedExistingLike: (row) => {
      prismaMock.user_patch_resource_like_relation.findUnique.mockResolvedValue(
        row
      )
    },
    toggle: async () => {
      const { toggleResourceLike } = await import(
        '~/app/api/patch/resource/like/service'
      )
      return toggleResourceLike({ resourceId: 10 }, LIKER_ID)
    }
  }
]

const resetMocks = () => {
  vi.clearAllMocks()
  prismaMock.$transaction.mockImplementation((fn) => fn(prismaMock._tx))
  createDedupMessageMock.mockResolvedValue({})
  moemoepointMock.earnMoemoepoint.mockResolvedValue({})
  moemoepointMock.reverseMoemoepoint.mockResolvedValue({})
}

for (const service of services) {
  describe(`${service.name} concurrent toggles`, () => {
    const relation = () => prismaMock._tx[service.relation]

    beforeEach(() => {
      resetMocks()
      service.seedTarget()
    })

    it('notifies and pays once when the like row is actually inserted', async () => {
      service.seedExistingLike(null)
      relation().createMany.mockResolvedValue({ count: 1 })

      await expect(service.toggle()).resolves.toBe(true)

      expect(relation().createMany).toHaveBeenCalledWith(
        expect.objectContaining({ skipDuplicates: true })
      )
      expect(createDedupMessageMock).toHaveBeenCalledTimes(1)
      expect(moemoepointMock.earnMoemoepoint).toHaveBeenCalledTimes(1)
      expect(moemoepointMock.reverseMoemoepoint).not.toHaveBeenCalled()
    })

    it('skips every side effect when a concurrent request already liked it', async () => {
      service.seedExistingLike(null)
      relation().createMany.mockResolvedValue({ count: 0 })

      await expect(service.toggle()).resolves.toBe(true)

      expect(createDedupMessageMock).not.toHaveBeenCalled()
      expect(moemoepointMock.earnMoemoepoint).not.toHaveBeenCalled()
      expect(moemoepointMock.reverseMoemoepoint).not.toHaveBeenCalled()
    })

    it('reverses the point once when the like row is actually removed', async () => {
      service.seedExistingLike({ id: 30 })
      relation().deleteMany.mockResolvedValue({ count: 1 })

      await expect(service.toggle()).resolves.toBe(false)

      expect(moemoepointMock.reverseMoemoepoint).toHaveBeenCalledTimes(1)
      expect(moemoepointMock.earnMoemoepoint).not.toHaveBeenCalled()
      expect(createDedupMessageMock).not.toHaveBeenCalled()
    })

    it('skips the reversal when a concurrent request already unliked it', async () => {
      service.seedExistingLike({ id: 30 })
      relation().deleteMany.mockResolvedValue({ count: 0 })

      await expect(service.toggle()).resolves.toBe(false)

      expect(moemoepointMock.reverseMoemoepoint).not.toHaveBeenCalled()
      expect(moemoepointMock.earnMoemoepoint).not.toHaveBeenCalled()
      expect(createDedupMessageMock).not.toHaveBeenCalled()
    })
  })
}

describe('like toggles never swallow a side-effect failure', () => {
  beforeEach(() => {
    resetMocks()
    seedComment()
    prismaMock.user_patch_comment_like_relation.findUnique.mockResolvedValue(
      null
    )
    prismaMock._tx.user_patch_comment_like_relation.createMany.mockResolvedValue(
      { count: 1 }
    )
  })

  it('rejects when the notification write hits its own unique violation', async () => {
    const error = uniqueViolation()
    createDedupMessageMock.mockRejectedValue(error)

    await expect(toggleComment()).rejects.toBe(error)
    expect(moemoepointMock.earnMoemoepoint).not.toHaveBeenCalled()
  })

  it('rejects when the ledger write hits its own unique violation', async () => {
    const error = uniqueViolation()
    moemoepointMock.earnMoemoepoint.mockRejectedValue(error)

    await expect(toggleComment()).rejects.toBe(error)
  })
})
