import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import { uploadImageToS3, deleteFileFromS3 } from '~/lib/s3'
import { preparePatchGalleryImage } from '~/app/api/edit/galleryUpload'
import { uploadPatchSubmissionBannerVariants } from './bannerUpload'
import {
  PATCH_SUBMISSION_EDITABLE_STATUSES,
  PATCH_SUBMISSION_GALLERY_MAX_COUNT,
  PATCH_SUBMISSION_MAX_TOTAL_BYTES,
  PATCH_SUBMISSION_UPLOAD_TAKEOVER_MS
} from '~/constants/patchSubmission'
import { PatchSubmissionError } from './quota'

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
const lockEditableSubmission = async (
  tx: Prisma.TransactionClient,
  submissionId: number,
  userId: number
) => {
  const rows = await tx.$queryRaw<
    { id: number; status: string; banner_key: string | null }[]
  >(
    Prisma.sql`
      SELECT id, status, banner_key
      FROM patch_submission
      WHERE id = ${submissionId} AND user_id = ${userId}
      FOR UPDATE
    `
  )
  const submission = rows[0]
  if (!submission) {
    throw new PatchSubmissionError('投稿不存在')
  }
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
    { slots: bigint; submission_bytes: bigint | null; user_bytes: bigint | null }[]
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
      if (usage.userBytes + buffer.byteLength > PATCH_SUBMISSION_MAX_TOTAL_BYTES) {
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
    return { galleryId: reserved.row.id, alreadyUploaded: true }
  }

  const prepared = await preparePatchGalleryImage(input.image, false)
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
    console.error('Failed to upload a submission gallery image', {
      galleryId: reserved.row.id,
      error
    })
    throw new PatchSubmissionError('截图上传失败, 请重试')
  }

  await prisma.patch_submission_gallery.update({
    where: { id: reserved.row.id },
    data: {
      upload_status: 'ready',
      image_key: imageKey,
      thumbnail_key: thumbnailKey,
      declared_bytes: prepared.buffer.byteLength,
      status_changed_at: new Date()
    }
  })

  return { galleryId: reserved.row.id, alreadyUploaded: false }
}

/** Frees the slot and the reserved bytes so the same id can be retried. */
const markGalleryFailed = (galleryId: number) =>
  prisma.patch_submission_gallery.update({
    where: { id: galleryId },
    data: {
      upload_status: 'failed',
      declared_bytes: 0,
      status_changed_at: new Date()
    }
  })

export const deletePatchSubmissionGalleryImage = async (
  submissionId: number,
  galleryId: number,
  userId: number
) => {
  const keys = await prisma.$transaction(
    async (tx) => {
      await lockEditableSubmission(tx, submissionId, userId)

      const image = await tx.patch_submission_gallery.findFirst({
        where: { id: galleryId, submission_id: submissionId },
        select: { image_key: true, thumbnail_key: true }
      })
      if (!image) {
        throw new PatchSubmissionError('截图不存在')
      }

      await tx.patch_submission_gallery.delete({ where: { id: galleryId } })
      return [image.image_key, image.thumbnail_key].filter(
        (key): key is string => Boolean(key)
      )
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
  )

  await Promise.all(
    keys.map((key) =>
      deleteFileFromS3(key).catch((error) => {
        console.error('Failed to delete a submission gallery object', {
          key,
          error
        })
      })
    )
  )

  return {}
}

interface BannerUploadInput {
  submissionId: number
  userId: number
  banner: ArrayBuffer
  bannerOriginal?: ArrayBuffer
}

export const uploadPatchSubmissionBanner = async (input: BannerUploadInput) => {
  const previous = await prisma.$transaction(
    async (tx) => {
      const submission = await lockEditableSubmission(
        tx,
        input.submissionId,
        input.userId
      )
      return submission.banner_key
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
  )

  const secret = newAssetSecret()
  const prefix = buildSubmissionAssetPrefix(input.submissionId, secret)
  const uploaded = await uploadPatchSubmissionBannerVariants({
    prefix,
    banner: input.banner,
    bannerOriginal: input.bannerOriginal
  })
  if (typeof uploaded === 'string') {
    throw new PatchSubmissionError(uploaded)
  }

  await prisma.patch_submission.update({
    where: { id: input.submissionId },
    data: {
      banner_key: uploaded.bannerKey,
      banner_thumbnail_key: uploaded.thumbnailKey,
      banner_original_key: uploaded.originalKey
    }
  })

  // Replacing a cover leaves the previous objects behind; they are no longer
  // referenced, so removing them here keeps the cleanup command's job small.
  if (previous) {
    const staleKeys = [
      previous,
      previous.replace(/banner\.avif$/, 'banner-mini.avif'),
      previous.replace(/banner\.avif$/, 'banner-full.avif')
    ]
    await Promise.all(
      staleKeys.map((key) =>
        deleteFileFromS3(key).catch(() => undefined)
      )
    )
  }

  return { bannerKey: uploaded.bannerKey }
}
