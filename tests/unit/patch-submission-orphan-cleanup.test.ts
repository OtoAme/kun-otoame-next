import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => ({
  patch_submission_orphan_cleanup: {
    upsert: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
    delete: vi.fn()
  },
  patch_submission: { findMany: vi.fn() },
  patch: { findMany: vi.fn() },
  patch_game_image: { findMany: vi.fn() }
}))
vi.mock('~/prisma/index', () => ({ prisma: prismaMocks }))

const deleteFileFromS3Mock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/s3', () => ({ deleteFileFromS3: deleteFileFromS3Mock }))

const purgeCloudflareCacheMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/utils/purgeCloudflareCache', () => ({
  purgeCloudflareCache: purgeCloudflareCacheMock
}))

import {
  buildSubmissionAssetPublicUrls,
  enqueueSubmissionOrphanCleanupJobs,
  loadServingSubmissionAssetKeys,
  processSubmissionOrphanCleanupJobs
} from '~/app/api/patch-submission/orphanCleanup'

const job = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  object_key: 'patch-submission/1-secret/gallery/1.avif',
  purge_urls: [
    'https://old-cdn.example/patch-submission/1-secret/gallery/1.avif'
  ],
  attempts: 0,
  ...overrides
})

beforeEach(() => {
  vi.clearAllMocks()
  process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL = 'https://img.example.test/'
  process.env.NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL =
    'https://cdn.example.test'

  prismaMocks.patch_submission_orphan_cleanup.upsert.mockImplementation(
    ({ create }) => Promise.resolve({ purge_urls: create.purge_urls })
  )
  prismaMocks.patch_submission_orphan_cleanup.update.mockResolvedValue({})
  prismaMocks.patch_submission_orphan_cleanup.findMany.mockResolvedValue([])
  prismaMocks.patch_submission_orphan_cleanup.delete.mockResolvedValue({})
  prismaMocks.patch_submission.findMany.mockResolvedValue([])
  prismaMocks.patch.findMany.mockResolvedValue([])
  prismaMocks.patch_game_image.findMany.mockResolvedValue([])
  deleteFileFromS3Mock.mockResolvedValue(undefined)
  purgeCloudflareCacheMock.mockResolvedValue({ status: 200, success: true })
})

describe('submission orphan cleanup enqueue', () => {
  it('builds and deduplicates complete public URLs for every configured base', () => {
    expect(buildSubmissionAssetPublicUrls(['patch-submission/a.avif'])).toEqual([
      'https://img.example.test/patch-submission/a.avif',
      'https://cdn.example.test/patch-submission/a.avif'
    ])
  })

  it('rejects keys outside the dedicated patch-submission prefix', async () => {
    await expect(
      enqueueSubmissionOrphanCleanupJobs(
        prismaMocks as never,
        ['patch/1/banner/banner.avif'],
        'banner_replace'
      )
    ).rejects.toThrow('Refused to enqueue a non-submission asset')

    expect(
      prismaMocks.patch_submission_orphan_cleanup.upsert
    ).not.toHaveBeenCalled()
  })

  it('persists the job before cleanup and unions old and current purge URLs', async () => {
    prismaMocks.patch_submission_orphan_cleanup.upsert.mockResolvedValue({
      purge_urls: [
        'https://old-cdn.example/patch-submission/1-secret/gallery/1.avif'
      ]
    })

    const keys = await enqueueSubmissionOrphanCleanupJobs(
      prismaMocks as never,
      ['patch-submission/1-secret/gallery/1.avif'],
      'gallery_delete'
    )

    expect(keys).toEqual(['patch-submission/1-secret/gallery/1.avif'])
    expect(
      prismaMocks.patch_submission_orphan_cleanup.upsert
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          object_key: 'patch-submission/1-secret/gallery/1.avif'
        },
        create: expect.objectContaining({ source: 'gallery_delete' })
      })
    )
    expect(
      prismaMocks.patch_submission_orphan_cleanup.update
    ).toHaveBeenCalledWith({
      where: { object_key: 'patch-submission/1-secret/gallery/1.avif' },
      data: {
        purge_urls: [
          'https://old-cdn.example/patch-submission/1-secret/gallery/1.avif',
          'https://img.example.test/patch-submission/1-secret/gallery/1.avif',
          'https://cdn.example.test/patch-submission/1-secret/gallery/1.avif'
        ]
      }
    })
  })
})

describe('serving reference projection', () => {
  it('protects active submissions and live patch rows, but not published provenance', async () => {
    prismaMocks.patch_submission.findMany.mockResolvedValue([
      {
        banner_key: 'patch-submission/active/banner/banner.avif',
        banner_thumbnail_key: null,
        banner_original_key: null,
        gallery: []
      }
    ])
    prismaMocks.patch.findMany.mockResolvedValue([
      {
        banner:
          'https://img.example.test/patch-submission/live/banner/banner.avif'
      }
    ])
    prismaMocks.patch_game_image.findMany.mockResolvedValue([
      {
        url: 'https://cdn.example.test/patch-submission/live/gallery/9.avif',
        thumbnail_url:
          'https://cdn.example.test/patch-submission/live/gallery/thumb-9.avif'
      }
    ])

    const referenced = await loadServingSubmissionAssetKeys(
      prismaMocks as never
    )

    expect(prismaMocks.patch_submission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { in: ['draft', 'pending', 'changes_requested'] }
        }
      })
    )
    expect(referenced).toEqual(
      new Set([
        'patch-submission/active/banner/banner.avif',
        'patch-submission/live/banner/banner.avif',
        'patch-submission/live/banner/banner-mini.avif',
        'patch-submission/live/banner/banner-full.avif',
        'patch-submission/live/gallery/9.avif',
        'patch-submission/live/gallery/thumb-9.avif'
      ])
    )
  })

  it('protects a live patch URL after its CDN hostname configuration changed', async () => {
    prismaMocks.patch.findMany.mockResolvedValue([
      {
        banner:
          'https://former-cdn.example/patch-submission/live/banner/banner.avif'
      }
    ])

    const referenced = await loadServingSubmissionAssetKeys(
      prismaMocks as never
    )

    expect(referenced).toContain(
      'patch-submission/live/banner/banner.avif'
    )
    expect(referenced).toContain(
      'patch-submission/live/banner/banner-mini.avif'
    )
  })
})

describe('submission orphan cleanup processing', () => {
  it('cancels a job whose object became serving again', async () => {
    prismaMocks.patch_submission_orphan_cleanup.findMany.mockResolvedValue([
      job()
    ])
    prismaMocks.patch_submission.findMany.mockResolvedValue([
      {
        banner_key: job().object_key,
        banner_thumbnail_key: null,
        banner_original_key: null,
        gallery: []
      }
    ])

    const result = await processSubmissionOrphanCleanupJobs({ limit: 10 })

    expect(result.cancelled).toBe(1)
    expect(deleteFileFromS3Mock).not.toHaveBeenCalled()
    expect(purgeCloudflareCacheMock).not.toHaveBeenCalled()
    expect(prismaMocks.patch_submission_orphan_cleanup.delete).toHaveBeenCalledWith(
      { where: { id: 1 } }
    )
  })

  it('purges and removes a persisted job even when the S3 object is already gone', async () => {
    prismaMocks.patch_submission_orphan_cleanup.findMany.mockResolvedValue([
      job()
    ])

    const result = await processSubmissionOrphanCleanupJobs({ limit: 10 })

    expect(deleteFileFromS3Mock).toHaveBeenCalledWith(job().object_key)
    expect(purgeCloudflareCacheMock).toHaveBeenCalledWith(
      expect.arrayContaining(job().purge_urls as string[])
    )
    expect(prismaMocks.patch_submission_orphan_cleanup.delete).toHaveBeenCalledWith(
      { where: { id: 1 } }
    )
    expect(result.done).toBe(1)
  })

  it('still purges after an S3 delete failure and retains the job', async () => {
    prismaMocks.patch_submission_orphan_cleanup.findMany.mockResolvedValue([
      job()
    ])
    deleteFileFromS3Mock.mockRejectedValue(new Error('storage unavailable'))

    const result = await processSubmissionOrphanCleanupJobs({ limit: 10 })

    expect(purgeCloudflareCacheMock).toHaveBeenCalledTimes(1)
    expect(prismaMocks.patch_submission_orphan_cleanup.delete).not.toHaveBeenCalled()
    expect(prismaMocks.patch_submission_orphan_cleanup.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({ attempts: { increment: 1 } })
      })
    )
    expect(result.owed).toBe(1)
  })

  it('retains the job when Cloudflare returns 200 with success false', async () => {
    prismaMocks.patch_submission_orphan_cleanup.findMany.mockResolvedValue([
      job()
    ])
    purgeCloudflareCacheMock.mockResolvedValue({ status: 200, success: false })

    const result = await processSubmissionOrphanCleanupJobs({ limit: 10 })

    expect(prismaMocks.patch_submission_orphan_cleanup.delete).not.toHaveBeenCalled()
    expect(prismaMocks.patch_submission_orphan_cleanup.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({ attempts: { increment: 1 } })
      })
    )
    expect(result.owed).toBe(1)
  })

  it('reports bookkeeping failure when external cleanup succeeded but deleting the job failed', async () => {
    prismaMocks.patch_submission_orphan_cleanup.findMany.mockResolvedValue([
      job()
    ])
    prismaMocks.patch_submission_orphan_cleanup.delete.mockRejectedValue(
      new Error('db unavailable')
    )

    const result = await processSubmissionOrphanCleanupJobs({ limit: 10 })

    expect(result.bookkeepingFailed).toBe(1)
    expect(result.done).toBe(0)
  })
})
