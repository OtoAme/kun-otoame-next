import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const prismaMocks = vi.hoisted(() => {
  const tx = {
    patch_submission: {
      findUnique: vi.fn(),
      updateMany: vi.fn()
    },
    patch_submission_gallery: { deleteMany: vi.fn() },
    admin_log: { create: vi.fn() },
    user_message: { create: vi.fn() }
  }
  return {
    $transaction: vi.fn((fn: (transaction: typeof tx) => Promise<unknown>) =>
      fn(tx)
    ),
    _tx: tx
  }
})

vi.mock('~/prisma/index', () => ({ prisma: prismaMocks }))

const publishSubmissionCoreMock = vi.hoisted(() => vi.fn())
const runPublishSideEffectsMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/patch-submission/publishCore', () => ({
  publishSubmissionCore: publishSubmissionCoreMock,
  runPublishSideEffects: runPublishSideEffectsMock
}))

const releaseMock = vi.hoisted(() => vi.fn())
const forfeitMock = vi.hoisted(() => vi.fn())
const earnMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/moemoepoint/service', () => ({
  releaseMoemoepoint: releaseMock,
  forfeitMoemoepoint: forfeitMock,
  earnMoemoepoint: earnMock
}))

const takeDownSubmissionAssetsMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/patch-submission/assetCleanup', () => ({
  takeDownSubmissionAssets: takeDownSubmissionAssetsMock
}))

import {
  approvePatchSubmission,
  rejectPatchSubmission,
  requestPatchSubmissionChanges,
  violatePatchSubmission
} from '~/app/api/patch-submission/review'
import { PatchSubmissionError } from '~/app/api/patch-submission/quota'

const tx = prismaMocks._tx

const admin = { uid: 9, name: 'admin', role: 3 }
const superAdmin = { uid: 5, name: 'root', role: 4 }
const stateChangedMessage = '投稿已被撤回或处理, 请刷新后重试'

const payload = {
  name: 'Some game',
  introduction: 'x'.repeat(20),
  vndbId: '',
  vndbRelationId: 'r1',
  bangumiId: '',
  steamId: '',
  dlsiteCode: '',
  dlsiteCircleName: '',
  dlsiteCircleLink: '',
  vndbTags: [],
  vndbDevelopers: [],
  bangumiTags: [],
  bangumiDevelopers: [],
  steamTags: [],
  steamDevelopers: [],
  steamAliases: [],
  officialUrl: '',
  alias: [],
  tag: [],
  released: '2026-08-24',
  contentLimit: 'sfw'
}

const pendingSubmission = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  user_id: 3,
  status: 'pending',
  name: 'Some game',
  payload,
  held_amount: 10,
  reservation_id: 7,
  banner_key: 'submission/1/banner.avif',
  banner_thumbnail_key: 'submission/1/banner-mini.avif',
  banner_original_key: null,
  gallery: [
    {
      image_key: 'submission/1/gallery/a.avif',
      thumbnail_key: 'submission/1/gallery/thumb-a.avif',
      is_nsfw: false,
      display_order: 0
    }
  ],
  ...overrides
})

beforeEach(() => {
  vi.clearAllMocks()
  process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL = 'https://img.example.test'
  tx.patch_submission.findUnique.mockResolvedValue(pendingSubmission())
  tx.patch_submission.updateMany.mockResolvedValue({ count: 1 })
  tx.patch_submission_gallery.deleteMany.mockResolvedValue({ count: 1 })
  tx.admin_log.create.mockResolvedValue({})
  tx.user_message.create.mockResolvedValue({})
  publishSubmissionCoreMock.mockResolvedValue({ id: 55, unique_id: 'abcd1234' })
  releaseMock.mockResolvedValue({
    balance: { total: 100, reserved: 0, available: 100 }
  })
  forfeitMock.mockResolvedValue({
    balance: { total: 90, reserved: 0, available: 90 }
  })
  earnMock.mockResolvedValue({
    balance: { total: 103, reserved: 0, available: 103 }
  })
  takeDownSubmissionAssetsMock.mockResolvedValue({
    status: 'done',
    completed: true,
    keyCount: 4,
    deleteFailures: 0,
    purgeConfirmed: true
  })
})

describe('review permissions', () => {
  it('refuses a reviewer below the minimum role', async () => {
    await expect(
      approvePatchSubmission(1, { uid: 2, name: 'user', role: 2 }, false)
    ).rejects.toBeInstanceOf(PatchSubmissionError)
    expect(publishSubmissionCoreMock).not.toHaveBeenCalled()
  })

  it('refuses self review', async () => {
    await expect(
      approvePatchSubmission(1, { uid: 3, name: 'author', role: 3 }, false)
    ).rejects.toBeInstanceOf(PatchSubmissionError)
  })

  it('refuses self review even with an override below super admin', async () => {
    await expect(
      approvePatchSubmission(1, { uid: 3, name: 'author', role: 3 }, true)
    ).rejects.toBeInstanceOf(PatchSubmissionError)
  })

  it('lets a super admin override self review and marks the log', async () => {
    tx.patch_submission.findUnique.mockResolvedValue(
      pendingSubmission({ user_id: superAdmin.uid })
    )

    await approvePatchSubmission(1, superAdmin, true)

    expect(tx.admin_log.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining('超级管理员自审 override')
        })
      })
    )
  })
})

describe('approval concurrency', () => {
  it('claims the submission with a status guarded update', async () => {
    await approvePatchSubmission(1, admin, false)

    expect(tx.patch_submission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1, status: 'pending' },
        data: expect.objectContaining({ status: 'published', patch_id: 55 })
      })
    )
  })

  it('fails when another reviewer or the author already changed the state', async () => {
    tx.patch_submission.updateMany.mockResolvedValue({ count: 0 })

    await expect(approvePatchSubmission(1, admin, false)).rejects.toThrow(
      stateChangedMessage
    )
    expect(runPublishSideEffectsMock).not.toHaveBeenCalled()
  })

  it('refuses a submission that is no longer pending', async () => {
    tx.patch_submission.findUnique.mockResolvedValue(
      pendingSubmission({ status: 'published' })
    )

    await expect(approvePatchSubmission(1, admin, false)).rejects.toThrow(
      stateChangedMessage
    )
  })
})

describe('approval settlement', () => {
  it('releases the deposit and pays the reward', async () => {
    await approvePatchSubmission(1, admin, false)

    expect(releaseMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        reservationId: 7,
        idempotencyKey: 'patch_submission:1:release'
      })
    )
    expect(earnMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        amount: 3,
        idempotencyKey: 'patch_submission:1:publish-reward'
      })
    )
  })

  it('only runs cache invalidation and IndexNow after the transaction', async () => {
    await approvePatchSubmission(1, admin, false)

    expect(runPublishSideEffectsMock).toHaveBeenCalledWith(
      expect.objectContaining({ uniqueId: 'abcd1234', contentLimit: 'sfw' })
    )
  })

  it('passes only ready gallery assets to the publish core', async () => {
    await approvePatchSubmission(1, admin, false)

    expect(publishSubmissionCoreMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        authorId: 3,
        bannerKey: 'submission/1/banner.avif',
        gallery: [
          expect.objectContaining({ key: 'submission/1/gallery/a.avif' })
        ]
      })
    )
  })
})

describe('approval external-id conflict', () => {
  const p2002 = (target: string[]) =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target }
    })

  it('turns a duplicate external id into a reviewer-facing error, not a 500', async () => {
    publishSubmissionCoreMock.mockRejectedValue(p2002(['vndb_relation_id']))

    await expect(approvePatchSubmission(1, admin, false)).rejects.toThrow(
      PatchSubmissionError
    )
    await expect(approvePatchSubmission(1, admin, false)).rejects.toThrow(
      'VNDB'
    )
    expect(runPublishSideEffectsMock).not.toHaveBeenCalled()
  })

  it('rethrows unexpected errors so real failures are not masked as duplicates', async () => {
    publishSubmissionCoreMock.mockRejectedValue(new Error('boom'))

    await expect(approvePatchSubmission(1, admin, false)).rejects.toThrow(
      'boom'
    )
  })
})

describe('reject', () => {
  it('returns the deposit and never forfeits', async () => {
    await rejectPatchSubmission(1, admin, '重复条目', false)

    expect(releaseMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ reservationId: 7 })
    )
    expect(forfeitMock).not.toHaveBeenCalled()
    expect(tx.patch_submission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'rejected',
          review_reason: '重复条目'
        })
      })
    )
  })

  it('runs the database-scoped takedown after settlement', async () => {
    await rejectPatchSubmission(1, admin, '重复条目', false)

    expect(takeDownSubmissionAssetsMock).toHaveBeenCalledWith(1)
  })
})

describe('request changes', () => {
  it('settles nothing', async () => {
    await requestPatchSubmissionChanges(1, admin, '请补充介绍', false)

    expect(releaseMock).not.toHaveBeenCalled()
    expect(forfeitMock).not.toHaveBeenCalled()
    expect(tx.patch_submission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'changes_requested' })
      })
    )
  })
})

describe('violation', () => {
  it('forfeits the deposit, hides the payload and preserves cleanup keys', async () => {
    await violatePatchSubmission(1, admin, '内容违规', false)

    expect(forfeitMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        reservationId: 7,
        idempotencyKey: 'patch_submission:1:forfeit'
      })
    )
    expect(releaseMock).not.toHaveBeenCalled()
    expect(tx.patch_submission_gallery.deleteMany).not.toHaveBeenCalled()
    expect(tx.patch_submission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'violation',
          payload: {}
        })
      })
    )
    const data = tx.patch_submission.updateMany.mock.calls[0][0].data
    expect(data).not.toHaveProperty('banner_key')
    expect(data).not.toHaveProperty('banner_thumbnail_key')
    expect(data).not.toHaveProperty('banner_original_key')
    expect(takeDownSubmissionAssetsMock).toHaveBeenCalledWith(1)
  })

  it('keeps the audit trail', async () => {
    await violatePatchSubmission(1, admin, '内容违规', false)

    const data = tx.patch_submission.updateMany.mock.calls[0][0].data
    expect(data.review_reason).toBe('内容违规')
    expect(data.reviewed_by_id).toBe(admin.uid)
    expect(data).not.toHaveProperty('held_amount')
    expect(data).not.toHaveProperty('name')
  })
})
