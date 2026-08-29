import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import { getS3PublicUrl, uploadImageToS3 } from '~/lib/s3'
import { preparePatchGalleryImage } from '~/app/api/edit/galleryUpload'
import { uploadPatchSubmissionBannerVariants } from './bannerUpload'
import {
  PATCH_SUBMISSION_EDITABLE_STATUSES,
  PATCH_SUBMISSION_GALLERY_MAX_COUNT,
  PATCH_SUBMISSION_MAX_TOTAL_BYTES,
  PATCH_SUBMISSION_UPLOAD_TAKEOVER_MS
} from '~/constants/patchSubmission'
import { PatchSubmissionError } from './quota'
import {
  enqueueSubmissionOrphanCleanupJobs,
  processSubmissionOrphanCleanupJobsBestEffort,
  type SubmissionOrphanCleanupSource
} from './orphanCleanup'

/**
 * Draft assets are written straight to the location the published entry keeps
 * using, so approval never moves an object. The address is unguessable and
 * generated server side: the client cannot choose where its bytes land, and a
 * pending submission is not discoverable by walking ids. It is not private
 * storage though — anyone holding the link can read it, and the product copy has
 * to say so.
 */
const buildSubmissionAssetPrefix = (submissionId: number, secret: string) =>
  `patch-submission/${submissionId}-${secret}`

const newAssetSecret = () => crypto.randomBytes(16).toString('hex')

const fingerprint = (buffer: Buffer) =>
  crypto.createHash('sha256').update(buffer).digest('hex')

/**
 * Locks the submission row, then verifies it is still editable. Every limit
 * check downstream depends on this lock: counting first and inserting after
 * would let concurrent uploads walk past the cap.
 */
const lockSubmission = async (
  tx: Prisma.TransactionClient,
  submissionId: number,
  userId: number
) => {
  const rows = await tx.$queryRaw<
    {
      id: number
      status: string
      banner_key: string | null
      banner_thumbnail_key: string | null
      banner_original_key: string | null
    }[]
  >(
    Prisma.sql`
      SELECT
        id,
        status,
        banner_key,
        banner_thumbnail_key,
        banner_original_key
      FROM patch_submission
      WHERE id = ${submissionId} AND user_id = ${userId}
      FOR UPDATE
    `
  )
  const submission = rows[0]
  if (!submission) {
    throw new PatchSubmissionError('投稿不存在')
  }
  return submission
}

const lockEditableSubmission = async (
  tx: Prisma.TransactionClient,
  submissionId: number,
  userId: number
) => {
  const submission = await lockSubmission(tx, submissionId, userId)
  if (
    !PATCH_SUBMISSION_EDITABLE_STATUSES.includes(
      submission.status as (typeof PATCH_SUBMISSION_EDITABLE_STATUSES)[number]
    )
  ) {
    throw new PatchSubmissionError(
      submission.status === 'pending'
        ? '投稿正在审核中, 无法修改素材'
        : '当前状态的投稿无法修改素材'
    )
  }
  return submission
}

const compactKeys = (keys: (string | null | undefined)[]) => [
  ...new Set(keys.filter((key): key is string => Boolean(key)))
]

const processOrphanKeysBestEffort = async (keys: string[]) => {
  await processSubmissionOrphanCleanupJobsBestEffort(keys, 'submission-assets')
}

const enqueueStandaloneOrphans = async (
  keys: string[],
  source: SubmissionOrphanCleanupSource
) => {
  if (!keys.length) return []
  try {
    const persisted = await prisma.$transaction((tx) =>
      enqueueSubmissionOrphanCleanupJobs(tx, keys, source)
    )
    await processOrphanKeysBestEffort(persisted)
    return persisted
  } catch (error) {
    // Do not delete without a durable purge credential. The S3 scanner can
    // still discover these unreferenced objects after its grace period.
    console.error('Failed to persist submission upload compensation', {
      keyCount: keys.length,
      error
    })
    return []
  }
}

/**
 * Slots and bytes in use for this submission and this user.
 *
 * `uploading` rows count. Only counting `ready` would mean several requests each
 * create an uploading row, all pass the check, and the submission ends up over
 * the limit once they finish. Rows stuck in `uploading` past the takeover window
 * are excluded so a crashed request cannot hold a slot forever.
 */
const measureUsage = async (
  tx: Prisma.TransactionClient,
  submissionId: number,
  userId: number
) => {
  const staleBefore = new Date(Date.now() - PATCH_SUBMISSION_UPLOAD_TAKEOVER_MS)

  const rows = await tx.$queryRaw<
    {
      slots: bigint
      submission_bytes: bigint | null
      user_bytes: bigint | null
    }[]
  >(
    Prisma.sql`
      SELECT
        COUNT(*) FILTER (
          WHERE gallery.submission_id = ${submissionId}
        ) AS slots,
        SUM(gallery.declared_bytes) FILTER (
          WHERE gallery.submission_id = ${submissionId}
        )::bigint AS submission_bytes,
        SUM(gallery.declared_bytes)::bigint AS user_bytes
      FROM patch_submission_gallery gallery
      JOIN patch_submission submission ON submission.id = gallery.submission_id
      WHERE submission.user_id = ${userId}
        AND submission.status IN ('draft', 'pending', 'changes_requested')
        AND (
          gallery.upload_status = 'ready'
          OR (
            gallery.upload_status = 'uploading'
            AND gallery.status_changed_at > ${staleBefore}
          )
        )
    `
  )

  return {
    slots: Number(rows[0]?.slots ?? 0),
    userBytes: Number(rows[0]?.user_bytes ?? 0)
  }
}

interface GalleryUploadInput {
  submissionId: number
  userId: number
  clientAssetId: string
  image: ArrayBuffer
  isNSFW: boolean
  watermark: boolean
  displayOrder: number
}

/**
 * Reserves a gallery slot, then uploads outside the transaction and marks the
 * row `ready`. A row is created before the bytes exist on purpose: that is what
 * makes the slot accounting correct under concurrency, and a request that dies
 * mid-upload leaves a `failed` row rather than a phantom image.
 */
export const uploadPatchSubmissionGalleryImage = async (
  input: GalleryUploadInput
) => {
  const buffer = Buffer.from(input.image)
  const digest = fingerprint(buffer)

  const reserved = await prisma.$transaction(
    async (tx) => {
      await lockEditableSubmission(tx, input.submissionId, input.userId)

      const existing = await tx.patch_submission_gallery.findUnique({
        where: {
          submission_id_client_asset_id: {
            submission_id: input.submissionId,
            client_asset_id: input.clientAssetId
          }
        },
        select: {
          id: true,
          upload_status: true,
          file_fingerprint: true,
          image_key: true,
          thumbnail_key: true,
          is_nsfw: true,
          display_order: true,
          status_changed_at: true
        }
      })

      if (existing) {
        // A retry of the same file resolves to the row that already exists.
        if (existing.file_fingerprint && existing.file_fingerprint !== digest) {
          throw new PatchSubmissionError(
            '同一张截图的重试内容与首次上传不一致, 请重新选择图片'
          )
        }
        if (existing.upload_status === 'ready') {
          return { row: existing, alreadyReady: true as const }
        }
        const stale =
          Date.now() - existing.status_changed_at.getTime() >
          PATCH_SUBMISSION_UPLOAD_TAKEOVER_MS
        if (existing.upload_status === 'uploading' && !stale) {
          throw new PatchSubmissionError('这张截图正在上传中, 请稍候')
        }

        const takenOver = await tx.patch_submission_gallery.update({
          where: { id: existing.id },
          data: {
            upload_status: 'uploading',
            declared_bytes: buffer.byteLength,
            file_fingerprint: digest,
            is_nsfw: input.isNSFW,
            display_order: input.displayOrder,
            status_changed_at: new Date()
          },
          select: { id: true }
        })
        return { row: takenOver, alreadyReady: false as const }
      }

      const usage = await measureUsage(tx, input.submissionId, input.userId)
      if (usage.slots >= PATCH_SUBMISSION_GALLERY_MAX_COUNT) {
        throw new PatchSubmissionError(
          `截图最多 ${PATCH_SUBMISSION_GALLERY_MAX_COUNT} 张`
        )
      }
      if (
        usage.userBytes + buffer.byteLength >
        PATCH_SUBMISSION_MAX_TOTAL_BYTES
      ) {
        throw new PatchSubmissionError(
          '您的投稿素材总体积已达上限, 请先删除不需要的图片'
        )
      }

      const created = await tx.patch_submission_gallery.create({
        data: {
          submission_id: input.submissionId,
          client_asset_id: input.clientAssetId,
          upload_status: 'uploading',
          declared_bytes: buffer.byteLength,
          file_fingerprint: digest,
          is_nsfw: input.isNSFW,
          display_order: input.displayOrder
        },
        select: { id: true }
      })
      return { row: created, alreadyReady: false as const }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
  )

  if (reserved.alreadyReady) {
    return {
      galleryId: reserved.row.id,
      alreadyUploaded: true,
      gallery: {
        id: reserved.row.id,
        clientAssetId: input.clientAssetId,
        uploadStatus: 'ready' as const,
        imageUrl: getS3PublicUrl(reserved.row.image_key),
        thumbnailUrl: getS3PublicUrl(reserved.row.thumbnail_key),
        isNSFW: reserved.row.is_nsfw,
        displayOrder: reserved.row.display_order
      }
    }
  }

  const prepared = await preparePatchGalleryImage(input.image, input.watermark)
  if (typeof prepared === 'string') {
    await markGalleryFailed(reserved.row.id)
    throw new PatchSubmissionError(prepared)
  }

  const secret = newAssetSecret()
  const prefix = buildSubmissionAssetPrefix(input.submissionId, secret)
  const imageKey = `${prefix}/gallery/${reserved.row.id}.${prepared.extension}`
  const thumbnailKey =
    prepared.thumbnailBuffer && prepared.thumbnailExtension
      ? `${prefix}/gallery/thumb-${reserved.row.id}.${prepared.thumbnailExtension}`
      : null

  const uploadedKeys = compactKeys([imageKey, thumbnailKey])
  try {
    await uploadImageToS3(imageKey, prepared.buffer, prepared.contentType)
    if (thumbnailKey && prepared.thumbnailBuffer) {
      await uploadImageToS3(
        thumbnailKey,
        prepared.thumbnailBuffer,
        prepared.thumbnailContentType
      )
    }
  } catch (error) {
    await markGalleryFailed(reserved.row.id)
    await enqueueStandaloneOrphans(uploadedKeys, 'upload_compensation')
    console.error('Failed to upload a submission gallery image', {
      galleryId: reserved.row.id,
      error
    })
    throw new PatchSubmissionError('截图上传失败, 请重试')
  }

  const finalized = await prisma.$transaction(async (tx) => {
    const updated = await tx.patch_submission_gallery.updateMany({
      where: {
        id: reserved.row.id,
        upload_status: 'uploading',
        submission: {
          user_id: input.userId,
          status: { in: [...PATCH_SUBMISSION_EDITABLE_STATUSES] }
        }
      },
      data: {
        upload_status: 'ready',
        image_key: imageKey,
        thumbnail_key: thumbnailKey,
        declared_bytes: prepared.buffer.byteLength,
        status_changed_at: new Date()
      }
    })
    if (updated.count > 0) return true

    await tx.patch_submission_gallery.deleteMany({
      where: { id: reserved.row.id, upload_status: 'uploading' }
    })
    await enqueueSubmissionOrphanCleanupJobs(
      tx,
      uploadedKeys,
      'upload_compensation'
    )
    return false
  })

  if (!finalized) {
    await processOrphanKeysBestEffort(uploadedKeys)
    throw new PatchSubmissionError(
      '投稿状态已变化, 本次上传未保存, 请刷新后重试'
    )
  }

  return {
    galleryId: reserved.row.id,
    alreadyUploaded: false,
    gallery: {
      id: reserved.row.id,
      clientAssetId: input.clientAssetId,
      uploadStatus: 'ready' as const,
      imageUrl: getS3PublicUrl(imageKey),
      thumbnailUrl: getS3PublicUrl(thumbnailKey),
      isNSFW: input.isNSFW,
      displayOrder: input.displayOrder
    }
  }
}

/** Frees the slot and the reserved bytes so the same id can be retried. */
const markGalleryFailed = (galleryId: number) =>
  prisma.patch_submission_gallery.updateMany({
    where: { id: galleryId, upload_status: 'uploading' },
    data: {
      upload_status: 'failed',
      declared_bytes: 0,
      status_changed_at: new Date()
    }
  })

export const deletePatchSubmissionGalleryImages = async (
  submissionId: number,
  galleryIds: number[],
  userId: number
) => {
  const keys = await prisma.$transaction(
    async (tx) => {
      await lockEditableSubmission(tx, submissionId, userId)

      const ids = [...new Set(galleryIds)]
      const images = await tx.patch_submission_gallery.findMany({
        where: { id: { in: ids }, submission_id: submissionId },
        select: { image_key: true, thumbnail_key: true }
      })
      if (images.length !== ids.length) {
        throw new PatchSubmissionError('所选截图不属于这条投稿')
      }

      await tx.patch_submission_gallery.deleteMany({
        where: { id: { in: ids }, submission_id: submissionId }
      })
      const keys = compactKeys(
        images.flatMap((image) => [image.image_key, image.thumbnail_key])
      )
      await enqueueSubmissionOrphanCleanupJobs(tx, keys, 'gallery_delete')
      return keys
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
  )

  await processOrphanKeysBestEffort(keys)

  return {}
}

export const updatePatchSubmissionGalleryNSFW = async (input: {
  submissionId: number
  galleryIds: number[]
  userId: number
  isNSFW: boolean
}) =>
  prisma.$transaction(
    async (tx) => {
      await lockEditableSubmission(tx, input.submissionId, input.userId)
      const ids = [...new Set(input.galleryIds)]
      const owned = await tx.patch_submission_gallery.findMany({
        where: { submission_id: input.submissionId, id: { in: ids } },
        select: { id: true }
      })
      if (owned.length !== ids.length) {
        throw new PatchSubmissionError('所选截图不属于这条投稿')
      }

      await tx.patch_submission_gallery.updateMany({
        where: { submission_id: input.submissionId, id: { in: ids } },
        data: { is_nsfw: input.isNSFW }
      })
      return {}
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
  )

interface BannerUploadInput {
  submissionId: number
  userId: number
  banner: ArrayBuffer
  bannerOriginal?: ArrayBuffer
}

export const uploadPatchSubmissionBanner = async (input: BannerUploadInput) => {
  await prisma.$transaction(
    async (tx) => {
      await lockEditableSubmission(tx, input.submissionId, input.userId)
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
  )

  const secret = newAssetSecret()
  const prefix = buildSubmissionAssetPrefix(input.submissionId, secret)
  const plannedKeys = compactKeys([
    `${prefix}/banner/banner.avif`,
    `${prefix}/banner/banner-mini.avif`,
    input.bannerOriginal ? `${prefix}/banner/banner-full.avif` : null
  ])
  let uploaded
  try {
    uploaded = await uploadPatchSubmissionBannerVariants({
      prefix,
      banner: input.banner,
      bannerOriginal: input.bannerOriginal
    })
  } catch (error) {
    await enqueueStandaloneOrphans(plannedKeys, 'upload_compensation')
    throw error
  }
  if (typeof uploaded === 'string') {
    throw new PatchSubmissionError(uploaded)
  }

  const newKeys = compactKeys([
    uploaded.bannerKey,
    uploaded.thumbnailKey,
    uploaded.originalKey
  ])
  const finalized = await prisma.$transaction(async (tx) => {
    const current = await lockSubmission(tx, input.submissionId, input.userId)
    const updated = await tx.patch_submission.updateMany({
      where: {
        id: input.submissionId,
        user_id: input.userId,
        status: { in: [...PATCH_SUBMISSION_EDITABLE_STATUSES] }
      },
      data: {
        banner_key: uploaded.bannerKey,
        banner_thumbnail_key: uploaded.thumbnailKey,
        banner_original_key: uploaded.originalKey
      }
    })

    if (updated.count === 0) {
      await enqueueSubmissionOrphanCleanupJobs(
        tx,
        newKeys,
        'upload_compensation'
      )
      return { attached: false, cleanupKeys: newKeys }
    }

    const staleKeys = compactKeys([
      current.banner_key,
      current.banner_thumbnail_key,
      current.banner_original_key
    ])
    await enqueueSubmissionOrphanCleanupJobs(tx, staleKeys, 'banner_replace')
    return { attached: true, cleanupKeys: staleKeys }
  })

  await processOrphanKeysBestEffort(finalized.cleanupKeys)
  if (!finalized.attached) {
    throw new PatchSubmissionError(
      '投稿状态已变化, 本次上传未保存, 请刷新后重试'
    )
  }

  return { bannerKey: uploaded.bannerKey }
}
