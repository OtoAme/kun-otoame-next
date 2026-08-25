import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    patch_submission: { updateMany: vi.fn() },
    patch_submission_gallery: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn()
    }
  }
  return {
    $transaction: vi.fn((fn: (transaction: typeof tx) => Promise<unknown>) =>
      fn(tx)
    ),
    patch_submission_gallery: {
      update: vi.fn(),
      updateMany: vi.fn()
    },
    patch_submission: { update: vi.fn() },
    _tx: tx
  }
})
vi.mock('~/prisma/index', () => ({ prisma: prismaMocks }))

const uploadImageToS3Mock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/s3', () => ({
  uploadImageToS3: uploadImageToS3Mock,
  getS3PublicUrl: (key: string | null) =>
    key ? `https://cdn.example.test/${key}` : null
}))

const preparePatchGalleryImageMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/edit/galleryUpload', () => ({
  preparePatchGalleryImage: preparePatchGalleryImageMock
}))

const uploadPatchSubmissionBannerVariantsMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/patch-submission/bannerUpload', () => ({
  uploadPatchSubmissionBannerVariants: uploadPatchSubmissionBannerVariantsMock
}))

const enqueueSubmissionOrphanCleanupJobsMock = vi.hoisted(() => vi.fn())
const processSubmissionOrphanCleanupJobsBestEffortMock = vi.hoisted(() =>
  vi.fn()
)
vi.mock('~/app/api/patch-submission/orphanCleanup', () => ({
  enqueueSubmissionOrphanCleanupJobs: enqueueSubmissionOrphanCleanupJobsMock,
  processSubmissionOrphanCleanupJobsBestEffort:
    processSubmissionOrphanCleanupJobsBestEffortMock
}))

import {
  deletePatchSubmissionGalleryImage,
  uploadPatchSubmissionBanner,
  uploadPatchSubmissionGalleryImage,
  updatePatchSubmissionGalleryNSFW
} from '~/app/api/patch-submission/assets'

const tx = prismaMocks._tx

const editableRow = {
  id: 1,
  status: 'draft',
  banner_key: 'patch-submission/1-old/banner/banner.avif',
  banner_thumbnail_key: 'patch-submission/1-old/banner/banner-mini.avif',
  banner_original_key: 'patch-submission/1-old/banner/banner-full.avif'
}

const preparedGallery = {
  buffer: Buffer.from('gallery'),
  extension: 'avif',
  contentType: 'image/avif',
  thumbnailBuffer: Buffer.from('thumb'),
  thumbnailExtension: 'avif',
  thumbnailContentType: 'image/avif'
}

beforeEach(() => {
  vi.clearAllMocks()
  tx.$queryRaw.mockReset()
  tx.$queryRaw
    .mockResolvedValueOnce([editableRow])
    .mockResolvedValueOnce([
      { slots: 0n, submission_bytes: 0n, user_bytes: 0n }
    ])
  tx.patch_submission_gallery.findUnique.mockResolvedValue(null)
  tx.patch_submission_gallery.create.mockResolvedValue({ id: 9 })
  tx.patch_submission_gallery.updateMany.mockResolvedValue({ count: 1 })
  tx.patch_submission_gallery.deleteMany.mockResolvedValue({ count: 1 })
  tx.patch_submission_gallery.delete.mockResolvedValue({})
  tx.patch_submission.updateMany.mockResolvedValue({ count: 1 })
  preparePatchGalleryImageMock.mockResolvedValue(preparedGallery)
  uploadImageToS3Mock.mockResolvedValue(undefined)
  uploadPatchSubmissionBannerVariantsMock.mockResolvedValue({
    bannerKey: 'patch-submission/1-new/banner/banner.avif',
    thumbnailKey: 'patch-submission/1-new/banner/banner-mini.avif',
    originalKey: 'patch-submission/1-new/banner/banner-full.avif'
  })
  enqueueSubmissionOrphanCleanupJobsMock.mockImplementation((_client, keys) =>
    Promise.resolve(keys)
  )
  processSubmissionOrphanCleanupJobsBestEffortMock.mockResolvedValue(undefined)
})

describe('gallery upload finalize fence', () => {
  it('does not attach uploaded objects after the submission became non-editable', async () => {
    tx.patch_submission_gallery.updateMany.mockResolvedValue({ count: 0 })

    await expect(
      uploadPatchSubmissionGalleryImage({
        submissionId: 1,
        userId: 2,
        clientAssetId: 'client-9',
        image: new ArrayBuffer(8),
        isNSFW: false,
        watermark: false,
        displayOrder: 0
      })
    ).rejects.toThrow('投稿状态已变化')

    expect(tx.patch_submission_gallery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 9,
          submission: expect.objectContaining({
            status: { in: ['draft', 'changes_requested'] }
          })
        })
      })
    )
    expect(tx.patch_submission_gallery.deleteMany).toHaveBeenCalledWith({
      where: { id: 9, upload_status: 'uploading' }
    })
    expect(enqueueSubmissionOrphanCleanupJobsMock).toHaveBeenCalledWith(
      tx,
      expect.arrayContaining([
        expect.stringContaining('/gallery/9.avif'),
        expect.stringContaining('/gallery/thumb-9.avif')
      ]),
      'upload_compensation'
    )
    expect(
      processSubmissionOrphanCleanupJobsBestEffortMock
    ).toHaveBeenCalledAfter(enqueueSubmissionOrphanCleanupJobsMock)
  })

  it('attaches ready keys only through the status-guarded transaction', async () => {
    const result = await uploadPatchSubmissionGalleryImage({
      submissionId: 1,
      userId: 2,
      clientAssetId: 'client-9',
      image: new ArrayBuffer(8),
      isNSFW: false,
      watermark: true,
      displayOrder: 0
    })

    expect(tx.patch_submission_gallery.updateMany).toHaveBeenCalledTimes(1)
    expect(preparePatchGalleryImageMock).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      true
    )
    expect(result.gallery).toMatchObject({
      id: 9,
      clientAssetId: 'client-9',
      uploadStatus: 'ready',
      imageUrl: expect.stringContaining('/gallery/9.avif')
    })
    expect(enqueueSubmissionOrphanCleanupJobsMock).not.toHaveBeenCalled()
  })

  it('returns the ready gallery DTO when a refresh retry reuses its stable client id', async () => {
    tx.$queryRaw.mockReset()
    tx.$queryRaw.mockResolvedValue([editableRow])
    tx.patch_submission_gallery.findUnique.mockResolvedValue({
      id: 9,
      upload_status: 'ready',
      file_fingerprint: null,
      image_key: 'patch-submission/1-secret/gallery/9.avif',
      thumbnail_key: 'patch-submission/1-secret/gallery/thumb-9.avif',
      is_nsfw: true,
      display_order: 2,
      status_changed_at: new Date()
    })

    const result = await uploadPatchSubmissionGalleryImage({
      submissionId: 1,
      userId: 2,
      clientAssetId: 'client-9',
      image: new ArrayBuffer(8),
      isNSFW: false,
      watermark: false,
      displayOrder: 0
    })

    expect(result).toMatchObject({
      galleryId: 9,
      alreadyUploaded: true,
      gallery: {
        clientAssetId: 'client-9',
        isNSFW: true,
        displayOrder: 2,
        imageUrl:
          'https://cdn.example.test/patch-submission/1-secret/gallery/9.avif'
      }
    })
    expect(preparePatchGalleryImageMock).not.toHaveBeenCalled()
    expect(uploadImageToS3Mock).not.toHaveBeenCalled()
  })
})

describe('submission gallery NSFW updates', () => {
  it('checks every selected id belongs to the editable submission', async () => {
    tx.$queryRaw.mockReset()
    tx.$queryRaw.mockResolvedValue([editableRow])
    tx.patch_submission_gallery.findMany.mockResolvedValue([{ id: 9 }])

    await expect(
      updatePatchSubmissionGalleryNSFW({
        submissionId: 1,
        galleryIds: [9, 10],
        userId: 2,
        isNSFW: true
      })
    ).rejects.toThrow('所选截图不属于这条投稿')

    expect(tx.patch_submission_gallery.updateMany).not.toHaveBeenCalled()
  })

  it('updates owned ids only after the editable-state lock', async () => {
    tx.$queryRaw.mockReset()
    tx.$queryRaw.mockResolvedValue([editableRow])
    tx.patch_submission_gallery.findMany.mockResolvedValue([
      { id: 9 },
      { id: 10 }
    ])

    await updatePatchSubmissionGalleryNSFW({
      submissionId: 1,
      galleryIds: [9, 10],
      userId: 2,
      isNSFW: true
    })

    expect(tx.patch_submission_gallery.updateMany).toHaveBeenCalledWith({
      where: { submission_id: 1, id: { in: [9, 10] } },
      data: { is_nsfw: true }
    })
  })

  it('rejects NSFW updates after the submission is no longer editable', async () => {
    tx.$queryRaw.mockReset()
    tx.$queryRaw.mockResolvedValue([{ ...editableRow, status: 'published' }])

    await expect(
      updatePatchSubmissionGalleryNSFW({
        submissionId: 1,
        galleryIds: [9],
        userId: 2,
        isNSFW: true
      })
    ).rejects.toThrow('当前状态的投稿无法修改素材')

    expect(tx.patch_submission_gallery.findMany).not.toHaveBeenCalled()
  })
})

describe('submission asset removals', () => {
  it('enqueues gallery keys in the same transaction that deletes their row', async () => {
    tx.patch_submission_gallery.findFirst.mockResolvedValue({
      image_key: 'patch-submission/1-secret/gallery/9.avif',
      thumbnail_key: 'patch-submission/1-secret/gallery/thumb-9.avif'
    })

    await deletePatchSubmissionGalleryImage(1, 9, 2)

    expect(tx.patch_submission_gallery.delete).toHaveBeenCalledWith({
      where: { id: 9 }
    })
    expect(enqueueSubmissionOrphanCleanupJobsMock).toHaveBeenCalledWith(
      tx,
      [
        'patch-submission/1-secret/gallery/9.avif',
        'patch-submission/1-secret/gallery/thumb-9.avif'
      ],
      'gallery_delete'
    )
    expect(
      processSubmissionOrphanCleanupJobsBestEffortMock
    ).toHaveBeenCalledAfter(enqueueSubmissionOrphanCleanupJobsMock)
  })

  it('replaces the banner and enqueues every old variant atomically', async () => {
    tx.$queryRaw.mockReset()
    tx.$queryRaw.mockResolvedValue([editableRow])

    await uploadPatchSubmissionBanner({
      submissionId: 1,
      userId: 2,
      banner: new ArrayBuffer(8),
      bannerOriginal: new ArrayBuffer(8)
    })

    expect(tx.patch_submission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 1,
          user_id: 2,
          status: { in: ['draft', 'changes_requested'] }
        })
      })
    )
    expect(enqueueSubmissionOrphanCleanupJobsMock).toHaveBeenCalledWith(
      tx,
      [
        editableRow.banner_key,
        editableRow.banner_thumbnail_key,
        editableRow.banner_original_key
      ],
      'banner_replace'
    )
  })

  it('outboxes every new banner variant when finalize loses the status race', async () => {
    tx.$queryRaw.mockReset()
    tx.$queryRaw.mockResolvedValue([editableRow])
    tx.patch_submission.updateMany.mockResolvedValue({ count: 0 })

    await expect(
      uploadPatchSubmissionBanner({
        submissionId: 1,
        userId: 2,
        banner: new ArrayBuffer(8),
        bannerOriginal: new ArrayBuffer(8)
      })
    ).rejects.toThrow('投稿状态已变化')

    expect(enqueueSubmissionOrphanCleanupJobsMock).toHaveBeenCalledWith(
      tx,
      [
        'patch-submission/1-new/banner/banner.avif',
        'patch-submission/1-new/banner/banner-mini.avif',
        'patch-submission/1-new/banner/banner-full.avif'
      ],
      'upload_compensation'
    )
  })
})
