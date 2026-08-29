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
  deletePatchSubmissionGalleryImages,
  uploadPatchSubmissionBanner,
  uploadPatchSubmissionGalleryImage,
  updatePatchSubmissionGalleryNSFW,
  updatePatchSubmissionGalleryOrder
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
  // Reserve lock, then the usage measurement, then the finalize lock.
  tx.$queryRaw
    .mockResolvedValueOnce([editableRow])
    .mockResolvedValueOnce([
      { slots: 0n, submission_bytes: 0n, user_bytes: 0n }
    ])
    .mockResolvedValue([editableRow])
  tx.patch_submission_gallery.findUnique.mockResolvedValue(null)
  tx.patch_submission_gallery.findFirst.mockResolvedValue(null)
  tx.patch_submission_gallery.update.mockResolvedValue({ id: 9 })
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
  it('enqueues gallery keys in the same transaction that deletes their rows', async () => {
    tx.patch_submission_gallery.findMany.mockResolvedValue([
      {
        image_key: 'patch-submission/1-secret/gallery/9.avif',
        thumbnail_key: 'patch-submission/1-secret/gallery/thumb-9.avif'
      },
      {
        image_key: 'patch-submission/1-secret/gallery/10.avif',
        thumbnail_key: 'patch-submission/1-secret/gallery/thumb-10.avif'
      }
    ])

    await deletePatchSubmissionGalleryImages(1, [9, 10], 2)

    expect(tx.patch_submission_gallery.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [9, 10] }, submission_id: 1 }
    })
    expect(enqueueSubmissionOrphanCleanupJobsMock).toHaveBeenCalledWith(
      tx,
      [
        'patch-submission/1-secret/gallery/9.avif',
        'patch-submission/1-secret/gallery/thumb-9.avif',
        'patch-submission/1-secret/gallery/10.avif',
        'patch-submission/1-secret/gallery/thumb-10.avif'
      ],
      'gallery_delete'
    )
    expect(
      processSubmissionOrphanCleanupJobsBestEffortMock
    ).toHaveBeenCalledAfter(enqueueSubmissionOrphanCleanupJobsMock)
  })

  it('rejects the whole batch when one id belongs to another submission', async () => {
    tx.patch_submission_gallery.findMany.mockResolvedValue([
      {
        image_key: 'patch-submission/1-secret/gallery/9.avif',
        thumbnail_key: null
      }
    ])

    await expect(
      deletePatchSubmissionGalleryImages(1, [9, 10], 2)
    ).rejects.toThrow('所选截图不属于这条投稿')

    expect(tx.patch_submission_gallery.deleteMany).not.toHaveBeenCalled()
    expect(enqueueSubmissionOrphanCleanupJobsMock).not.toHaveBeenCalled()
    expect(
      processSubmissionOrphanCleanupJobsBestEffortMock
    ).not.toHaveBeenCalled()
  })

  it('deduplicates repeated ids before matching them against the submission', async () => {
    tx.patch_submission_gallery.findMany.mockResolvedValue([
      {
        image_key: 'patch-submission/1-secret/gallery/9.avif',
        thumbnail_key: null
      }
    ])

    await deletePatchSubmissionGalleryImages(1, [9, 9], 2)

    expect(tx.patch_submission_gallery.findMany).toHaveBeenCalledWith({
      where: { id: { in: [9] }, submission_id: 1 },
      select: { image_key: true, thumbnail_key: true }
    })
    expect(tx.patch_submission_gallery.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [9] }, submission_id: 1 }
    })
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

describe('gallery upload display order reservation', () => {
  it('refuses a slot number another live row already holds', async () => {
    tx.patch_submission_gallery.findFirst.mockResolvedValue({ id: 11 })

    await expect(
      uploadPatchSubmissionGalleryImage({
        submissionId: 1,
        userId: 2,
        clientAssetId: 'client-9',
        image: new ArrayBuffer(8),
        isNSFW: false,
        watermark: false,
        displayOrder: 3
      })
    ).rejects.toThrow('截图顺序存在冲突')

    expect(tx.patch_submission_gallery.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          submission_id: 1,
          display_order: 3,
          client_asset_id: { not: 'client-9' }
        })
      })
    )
    expect(tx.patch_submission_gallery.create).not.toHaveBeenCalled()
    expect(preparePatchGalleryImageMock).not.toHaveBeenCalled()
  })

  it('ignores rows that belong to the retry of this very client asset id', async () => {
    await uploadPatchSubmissionGalleryImage({
      submissionId: 1,
      userId: 2,
      clientAssetId: 'client-9',
      image: new ArrayBuffer(8),
      isNSFW: false,
      watermark: false,
      displayOrder: 3
    })

    const where = tx.patch_submission_gallery.findFirst.mock.calls[0]?.[0]
      ?.where as { client_asset_id: { not: string }; OR: unknown[] }
    expect(where.client_asset_id).toEqual({ not: 'client-9' })
    // Stale uploading rows never held the slot, so they cannot wedge it either.
    expect(where.OR).toEqual([
      { upload_status: 'ready' },
      expect.objectContaining({ upload_status: 'uploading' })
    ])
    expect(tx.patch_submission_gallery.create).toHaveBeenCalled()
  })

  it('checks the slot inside the lock when an earlier attempt is taken over', async () => {
    tx.$queryRaw.mockReset()
    tx.$queryRaw.mockResolvedValue([editableRow])
    tx.patch_submission_gallery.findUnique.mockResolvedValue({
      id: 9,
      upload_status: 'failed',
      file_fingerprint: null,
      image_key: null,
      thumbnail_key: null,
      is_nsfw: false,
      display_order: 0,
      status_changed_at: new Date()
    })
    tx.patch_submission_gallery.findFirst.mockResolvedValue({ id: 11 })

    await expect(
      uploadPatchSubmissionGalleryImage({
        submissionId: 1,
        userId: 2,
        clientAssetId: 'client-9',
        image: new ArrayBuffer(8),
        isNSFW: false,
        watermark: false,
        displayOrder: 3
      })
    ).rejects.toThrow('截图顺序存在冲突')

    expect(tx.patch_submission_gallery.update).not.toHaveBeenCalled()
  })
})

describe('gallery upload finalize lock ordering', () => {
  it('locks the submission row before writing the ready state', async () => {
    await uploadPatchSubmissionGalleryImage({
      submissionId: 1,
      userId: 2,
      clientAssetId: 'client-9',
      image: new ArrayBuffer(8),
      isNSFW: false,
      watermark: false,
      displayOrder: 0
    })

    // Reserve lock, usage measurement, finalize lock.
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3)
    expect(tx.$queryRaw).toHaveBeenCalledBefore(
      tx.patch_submission_gallery.updateMany
    )
  })

  it('still compensates when the lock finds a submission that turned non-editable', async () => {
    tx.$queryRaw.mockReset()
    tx.$queryRaw
      .mockResolvedValueOnce([editableRow])
      .mockResolvedValueOnce([
        { slots: 0n, submission_bytes: 0n, user_bytes: 0n }
      ])
      .mockResolvedValue([{ ...editableRow, status: 'pending' }])
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

    expect(tx.patch_submission_gallery.deleteMany).toHaveBeenCalledWith({
      where: { id: 9, upload_status: 'uploading' }
    })
    expect(enqueueSubmissionOrphanCleanupJobsMock).toHaveBeenCalledWith(
      tx,
      expect.arrayContaining([expect.stringContaining('/gallery/9.avif')]),
      'upload_compensation'
    )
    expect(
      processSubmissionOrphanCleanupJobsBestEffortMock
    ).toHaveBeenCalledAfter(enqueueSubmissionOrphanCleanupJobsMock)
  })

  it('still compensates when the submission row is gone entirely', async () => {
    tx.$queryRaw.mockReset()
    tx.$queryRaw
      .mockResolvedValueOnce([editableRow])
      .mockResolvedValueOnce([
        { slots: 0n, submission_bytes: 0n, user_bytes: 0n }
      ])
      .mockResolvedValue([])
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

    expect(enqueueSubmissionOrphanCleanupJobsMock).toHaveBeenCalledWith(
      tx,
      expect.any(Array),
      'upload_compensation'
    )
  })
})

describe('submission gallery order updates', () => {
  const readyRows = (ids: number[]) => ids.map((id) => ({ id }))

  beforeEach(() => {
    tx.$queryRaw.mockReset()
    tx.$queryRaw.mockResolvedValue([editableRow])
  })

  it('writes every row inside the editable-state lock', async () => {
    tx.patch_submission_gallery.findMany.mockResolvedValue(readyRows([9, 10]))

    await expect(
      updatePatchSubmissionGalleryOrder({
        submissionId: 1,
        userId: 2,
        order: [
          { galleryId: 10, displayOrder: 0 },
          { galleryId: 9, displayOrder: 2 }
        ]
      })
    ).resolves.toEqual({})

    expect(tx.patch_submission_gallery.findMany).toHaveBeenCalledWith({
      where: { submission_id: 1, upload_status: 'ready' },
      select: { id: true }
    })
    expect(tx.patch_submission_gallery.update).toHaveBeenNthCalledWith(1, {
      where: { id: 10 },
      data: { display_order: 0 }
    })
    // Local cards may hold the slot in between, so gaps are legal.
    expect(tx.patch_submission_gallery.update).toHaveBeenNthCalledWith(2, {
      where: { id: 9 },
      data: { display_order: 2 }
    })
  })

  it('rejects an order that does not name every ready row', async () => {
    tx.patch_submission_gallery.findMany.mockResolvedValue(readyRows([9, 10]))

    await expect(
      updatePatchSubmissionGalleryOrder({
        submissionId: 1,
        userId: 2,
        order: [{ galleryId: 9, displayOrder: 0 }]
      })
    ).rejects.toThrow('截图列表已变化')

    expect(tx.patch_submission_gallery.update).not.toHaveBeenCalled()
  })

  it('rejects an order naming a row that is not ready', async () => {
    tx.patch_submission_gallery.findMany.mockResolvedValue(readyRows([9]))

    await expect(
      updatePatchSubmissionGalleryOrder({
        submissionId: 1,
        userId: 2,
        order: [
          { galleryId: 9, displayOrder: 0 },
          { galleryId: 10, displayOrder: 1 }
        ]
      })
    ).rejects.toThrow('截图列表已变化')

    expect(tx.patch_submission_gallery.update).not.toHaveBeenCalled()
  })

  it('rejects a repeated gallery id before touching the database', async () => {
    await expect(
      updatePatchSubmissionGalleryOrder({
        submissionId: 1,
        userId: 2,
        order: [
          { galleryId: 9, displayOrder: 0 },
          { galleryId: 9, displayOrder: 1 }
        ]
      })
    ).rejects.toThrow('同一张截图出现了多次')

    expect(tx.patch_submission_gallery.findMany).not.toHaveBeenCalled()
    expect(tx.patch_submission_gallery.update).not.toHaveBeenCalled()
  })

  it('rejects a repeated display order before touching the database', async () => {
    await expect(
      updatePatchSubmissionGalleryOrder({
        submissionId: 1,
        userId: 2,
        order: [
          { galleryId: 9, displayOrder: 1 },
          { galleryId: 10, displayOrder: 1 }
        ]
      })
    ).rejects.toThrow('存在重复的位置')

    expect(tx.patch_submission_gallery.findMany).not.toHaveBeenCalled()
    expect(tx.patch_submission_gallery.update).not.toHaveBeenCalled()
  })

  it('accepts an empty order when the submission has no ready row yet', async () => {
    tx.patch_submission_gallery.findMany.mockResolvedValue([])

    await expect(
      updatePatchSubmissionGalleryOrder({
        submissionId: 1,
        userId: 2,
        order: []
      })
    ).resolves.toEqual({})

    expect(tx.patch_submission_gallery.update).not.toHaveBeenCalled()
  })

  it('rejects an empty order while ready rows still exist', async () => {
    tx.patch_submission_gallery.findMany.mockResolvedValue(readyRows([9]))

    await expect(
      updatePatchSubmissionGalleryOrder({
        submissionId: 1,
        userId: 2,
        order: []
      })
    ).rejects.toThrow('截图列表已变化')
  })

  it('refuses to reorder a submission that is no longer editable', async () => {
    tx.$queryRaw.mockResolvedValue([{ ...editableRow, status: 'pending' }])

    await expect(
      updatePatchSubmissionGalleryOrder({
        submissionId: 1,
        userId: 2,
        order: [{ galleryId: 9, displayOrder: 0 }]
      })
    ).rejects.toThrow('投稿正在审核中, 无法修改素材')

    expect(tx.patch_submission_gallery.findMany).not.toHaveBeenCalled()
  })
})
