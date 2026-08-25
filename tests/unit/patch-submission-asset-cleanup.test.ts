import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => ({
  patch_submission: { findUnique: vi.fn(), update: vi.fn() },
  patch_submission_gallery: { deleteMany: vi.fn() },
  $transaction: vi.fn()
}))
vi.mock('~/prisma/index', () => ({ prisma: prismaMocks }))

const deleteFileFromS3Mock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/s3', () => ({ deleteFileFromS3: deleteFileFromS3Mock }))

const purgeCloudflareCacheMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/utils/purgeCloudflareCache', () => ({
  purgeCloudflareCache: purgeCloudflareCacheMock
}))

import {
  collectSubmissionAssetKeys,
  purgeSubmissionAssets,
  takeDownSubmissionAssets
} from '~/app/api/patch-submission/assetCleanup'

const row = (overrides: Record<string, unknown> = {}) => ({
  status: 'rejected',
  banner_key: 'patch-submission/1-a/banner/banner.avif',
  banner_thumbnail_key: 'patch-submission/1-a/banner/banner-mini.avif',
  banner_original_key: null,
  gallery: [
    {
      image_key: 'patch-submission/1-a/gallery/1.avif',
      thumbnail_key: 'patch-submission/1-a/gallery/thumb-1.avif'
    }
  ],
  ...overrides
})

beforeEach(() => {
  vi.clearAllMocks()
  process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL = 'https://img.example.test'
  process.env.NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL =
    'https://img.example.test'
  deleteFileFromS3Mock.mockResolvedValue(undefined)
  purgeCloudflareCacheMock.mockResolvedValue({ status: 200, success: true })
  prismaMocks.patch_submission.findUnique.mockResolvedValue(row())
  prismaMocks.$transaction.mockResolvedValue([])
})

describe('collectSubmissionAssetKeys', () => {
  it('gathers cover variants and gallery keys, skipping nulls', () => {
    expect(collectSubmissionAssetKeys(row())).toEqual([
      'patch-submission/1-a/banner/banner.avif',
      'patch-submission/1-a/banner/banner-mini.avif',
      'patch-submission/1-a/gallery/1.avif',
      'patch-submission/1-a/gallery/thumb-1.avif'
    ])
  })

  it('deduplicates so one key cannot be deleted or counted twice', () => {
    const keys = collectSubmissionAssetKeys(
      row({
        banner_thumbnail_key: 'patch-submission/1-a/banner/banner.avif',
        gallery: [
          {
            image_key: 'patch-submission/1-a/banner/banner.avif',
            thumbnail_key: null
          }
        ]
      })
    )
    expect(keys).toEqual(['patch-submission/1-a/banner/banner.avif'])
  })
})

describe('purgeSubmissionAssets', () => {
  it('treats an empty key list as already done', async () => {
    const result = await purgeSubmissionAssets([])
    expect(result.completed).toBe(true)
    expect(purgeCloudflareCacheMock).not.toHaveBeenCalled()
  })

  it('still purges when one delete failed, so the rest leave the edge', async () => {
    deleteFileFromS3Mock
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValue(undefined)

    const result = await purgeSubmissionAssets(['a.avif', 'b.avif', 'c.avif'])

    expect(purgeCloudflareCacheMock).toHaveBeenCalledTimes(1)
    expect(result.deleteFailures).toBe(1)
    expect(result.completed).toBe(false)
  })

  it('purges every configured public base, because a purge is keyed by full URL', async () => {
    process.env.NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL =
      'https://cdn.example.test'

    await purgeSubmissionAssets(['a.avif'])

    expect(purgeCloudflareCacheMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        'https://img.example.test/a.avif',
        'https://cdn.example.test/a.avif'
      ])
    )
  })

  it('deduplicates bases that are configured to the same host', async () => {
    await purgeSubmissionAssets(['a.avif'])
    expect(purgeCloudflareCacheMock).toHaveBeenCalledWith([
      'https://img.example.test/a.avif'
    ])
  })

  it.each([
    ['a missing token', { status: 0, success: false }],
    ['an HTTP failure', { status: 502, success: false }],
    ['a 200 the API did not confirm', { status: 200, success: false }]
  ])('reports %s as unfinished', async (_label, purgeResult) => {
    purgeCloudflareCacheMock.mockResolvedValue(purgeResult)

    const result = await purgeSubmissionAssets(['a.avif'])

    expect(result.purgeConfirmed).toBe(false)
    expect(result.completed).toBe(false)
  })
})

describe('takeDownSubmissionAssets status fence', () => {
  it.each(['draft', 'pending', 'changes_requested'])(
    'refuses an active submission (%s)',
    async (status) => {
      prismaMocks.patch_submission.findUnique.mockResolvedValue(row({ status }))

      const outcome = await takeDownSubmissionAssets(1)

      expect(outcome).toEqual({ status: 'skipped', reason: 'not-cleanable' })
      expect(deleteFileFromS3Mock).not.toHaveBeenCalled()
      expect(prismaMocks.$transaction).not.toHaveBeenCalled()
    }
  )

  it('refuses a published submission, whose assets the live entry is serving', async () => {
    prismaMocks.patch_submission.findUnique.mockResolvedValue(
      row({ status: 'published' })
    )

    const outcome = await takeDownSubmissionAssets(1)

    expect(outcome).toEqual({ status: 'skipped', reason: 'not-cleanable' })
    expect(deleteFileFromS3Mock).not.toHaveBeenCalled()
    expect(prismaMocks.$transaction).not.toHaveBeenCalled()
  })

  it('skips a submission that no longer exists', async () => {
    prismaMocks.patch_submission.findUnique.mockResolvedValue(null)

    expect(await takeDownSubmissionAssets(1)).toEqual({
      status: 'skipped',
      reason: 'missing'
    })
  })

  it.each(['rejected', 'violation', 'deleted'])(
    'proceeds for %s',
    async (status) => {
      prismaMocks.patch_submission.findUnique.mockResolvedValue(row({ status }))

      const outcome = await takeDownSubmissionAssets(1)

      expect(outcome.status).toBe('done')
      expect(deleteFileFromS3Mock).toHaveBeenCalledTimes(4)
      expect(prismaMocks.$transaction).toHaveBeenCalledTimes(1)
    }
  )
})

describe('takeDownSubmissionAssets outbox', () => {
  it('derives the key list from the row, not from any caller input', async () => {
    await takeDownSubmissionAssets(1)

    expect(deleteFileFromS3Mock.mock.calls.map(([key]) => key)).toEqual(
      collectSubmissionAssetKeys(row())
    )
  })

  it('keeps the keys on the row when the purge was not confirmed', async () => {
    purgeCloudflareCacheMock.mockResolvedValue({ status: 0, success: false })

    const outcome = await takeDownSubmissionAssets(1)

    expect(outcome.status).toBe('owed')
    expect(prismaMocks.$transaction).not.toHaveBeenCalled()
  })

  it('keeps the keys on the row when a delete failed', async () => {
    deleteFileFromS3Mock.mockRejectedValue(new Error('storage unavailable'))

    const outcome = await takeDownSubmissionAssets(1)

    expect(outcome.status).toBe('owed')
    expect(prismaMocks.$transaction).not.toHaveBeenCalled()
  })

  it('clears the keys and the gallery rows once the takedown is confirmed', async () => {
    await takeDownSubmissionAssets(1)

    expect(prismaMocks.patch_submission_gallery.deleteMany).toHaveBeenCalledWith(
      { where: { submission_id: 1 } }
    )
    expect(prismaMocks.patch_submission.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        banner_key: null,
        banner_thumbnail_key: null,
        banner_original_key: null
      }
    })
  })

  it('still removes failed placeholder rows when there is nothing to delete', async () => {
    prismaMocks.patch_submission.findUnique.mockResolvedValue(
      row({
        banner_key: null,
        banner_thumbnail_key: null,
        banner_original_key: null,
        gallery: [{ image_key: null, thumbnail_key: null }]
      })
    )

    const outcome = await takeDownSubmissionAssets(1)

    expect(outcome.status).toBe('done')
    expect(deleteFileFromS3Mock).not.toHaveBeenCalled()
    expect(prismaMocks.$transaction).toHaveBeenCalledTimes(1)
  })

  it('reports a bookkeeping failure separately from an unfinished takedown', async () => {
    prismaMocks.$transaction.mockRejectedValue(new Error('db down'))

    expect(await takeDownSubmissionAssets(1)).toEqual({
      status: 'bookkeeping-failed',
      completed: true,
      keyCount: 4,
      deleteFailures: 0,
      purgeConfirmed: true
    })
  })

  it('reports a database read failure instead of throwing after settlement', async () => {
    prismaMocks.patch_submission.findUnique.mockRejectedValue(
      new Error('db unavailable')
    )

    await expect(takeDownSubmissionAssets(1)).resolves.toEqual({
      status: 'bookkeeping-failed',
      completed: false,
      keyCount: 0,
      deleteFailures: 0,
      purgeConfirmed: false
    })
  })
})
