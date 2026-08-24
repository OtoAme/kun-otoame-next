import { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import { releaseMoemoepoint } from '~/app/api/moemoepoint/service'
import { getS3PublicUrl } from '~/lib/s3'
import {
  PATCH_SUBMISSION_ACTIVE_STATUSES,
  PATCH_SUBMISSION_EDITABLE_STATUSES,
  PATCH_SUBMISSION_MAX_TOTAL_BYTES,
  PATCH_SUBMISSION_REASON,
  getPatchSubmissionDeposit
} from '~/constants/patchSubmission'
import { PatchSubmissionError, sumActiveSubmissionBytes } from './quota'
import type {
  PatchSubmission,
  PatchSubmissionGalleryImage,
  PatchSubmissionPayload,
  PatchSubmissionQuota,
  PatchSubmissionStatus,
  PatchSubmissionSummary,
  PatchSubmissionUploadStatus
} from '~/types/api/patchSubmission'

const submissionSelect = {
  id: true,
  status: true,
  payload: true,
  payload_version: true,
  revision: true,
  held_amount: true,
  role_at_creation: true,
  review_reason: true,
  reviewed_at: true,
  external_source: true,
  external_fetched_at: true,
  banner_key: true,
  submitted_at: true,
  created: true,
  updated: true,
  patch: { select: { unique_id: true } },
  gallery: {
    orderBy: { display_order: 'asc' as const },
    select: {
      id: true,
      client_asset_id: true,
      upload_status: true,
      image_key: true,
      thumbnail_key: true,
      is_nsfw: true,
      display_order: true
    }
  }
} satisfies Prisma.patch_submissionSelect

type SubmissionRow = Prisma.patch_submissionGetPayload<{
  select: typeof submissionSelect
}>

const toGalleryImage = (
  image: SubmissionRow['gallery'][number]
): PatchSubmissionGalleryImage => ({
  id: image.id,
  clientAssetId: image.client_asset_id,
  uploadStatus: image.upload_status as PatchSubmissionUploadStatus,
  imageUrl: getS3PublicUrl(image.image_key),
  thumbnailUrl: getS3PublicUrl(image.thumbnail_key),
  isNSFW: image.is_nsfw,
  displayOrder: image.display_order
})

const toSubmission = (row: SubmissionRow): PatchSubmission => ({
  id: row.id,
  status: row.status as PatchSubmissionStatus,
  payload: row.payload as unknown as PatchSubmissionPayload,
  payloadVersion: row.payload_version,
  revision: row.revision,
  heldAmount: row.held_amount,
  roleAtCreation: row.role_at_creation,
  reviewReason: row.review_reason,
  reviewedAt: row.reviewed_at?.toISOString() ?? null,
  patchUniqueId: row.patch?.unique_id ?? null,
  bannerUrl: getS3PublicUrl(row.banner_key),
  externalSource: row.external_source,
  externalFetchedAt: row.external_fetched_at?.toISOString() ?? null,
  gallery: row.gallery.map(toGalleryImage),
  submittedAt: row.submitted_at?.toISOString() ?? null,
  created: row.created.toISOString(),
  updated: row.updated.toISOString()
})

/** Ownership is checked here rather than in the route, so no caller can skip it. */
export const getPatchSubmission = async (
  submissionId: number,
  userId: number
): Promise<PatchSubmission | string> => {
  const row = await prisma.patch_submission.findFirst({
    where: { id: submissionId, user_id: userId },
    select: submissionSelect
  })
  if (!row) {
    return '投稿不存在'
  }
  return toSubmission(row)
}

export const listOwnPatchSubmissions = async (
  userId: number,
  page: number,
  limit: number
): Promise<{ submissions: PatchSubmissionSummary[]; total: number }> => {
  const where: Prisma.patch_submissionWhereInput = {
    user_id: userId,
    // A hidden terminal record stays in the database for audit, it just leaves
    // the author's list.
    OR: [
      { status: { in: [...PATCH_SUBMISSION_ACTIVE_STATUSES] } },
      { hidden_by_user: false }
    ]
  }

  const [rows, total] = await Promise.all([
    prisma.patch_submission.findMany({
      where,
      orderBy: { created: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        status: true,
        name: true,
        held_amount: true,
        review_reason: true,
        submitted_at: true,
        created: true,
        updated: true,
        patch: { select: { unique_id: true } }
      }
    }),
    prisma.patch_submission.count({ where })
  ])

  return {
    total,
    submissions: rows.map((row) => ({
      id: row.id,
      status: row.status as PatchSubmissionStatus,
      name: row.name,
      heldAmount: row.held_amount,
      reviewReason: row.review_reason,
      patchUniqueId: row.patch?.unique_id ?? null,
      submittedAt: row.submitted_at?.toISOString() ?? null,
      created: row.created.toISOString(),
      updated: row.updated.toISOString()
    }))
  }
}

export const getPatchSubmissionQuota = async (
  userId: number,
  role: number
): Promise<PatchSubmissionQuota> => {
  const deposit = getPatchSubmissionDeposit(role)
  const [activeCount, usedBytes] = await Promise.all([
    prisma.patch_submission.count({
      where: {
        user_id: userId,
        status: { in: [...PATCH_SUBMISSION_ACTIVE_STATUSES] }
      }
    }),
    sumActiveSubmissionBytes(prisma, userId)
  ])

  return {
    activeCount,
    maxActive: deposit.maxActive,
    depositAmount: deposit.amount,
    usedBytes,
    maxBytes: PATCH_SUBMISSION_MAX_TOTAL_BYTES
  }
}

interface UpdateDraftInput {
  submissionId: number
  userId: number
  revision: number
  payload: PatchSubmissionPayload
  externalSource: string
}

/**
 * Autosave. The revision is an optimistic lock, so a second device that has been
 * editing an older copy is told to reload instead of silently overwriting. Only
 * editable states accept writes: `pending` is locked while a reviewer holds it.
 */
export const updatePatchSubmissionDraft = async (input: UpdateDraftInput) => {
  const current = await prisma.patch_submission.findFirst({
    where: { id: input.submissionId, user_id: input.userId },
    select: { status: true, revision: true }
  })
  if (!current) {
    return '投稿不存在'
  }
  if (
    !PATCH_SUBMISSION_EDITABLE_STATUSES.includes(
      current.status as (typeof PATCH_SUBMISSION_EDITABLE_STATUSES)[number]
    )
  ) {
    return current.status === 'pending'
      ? '投稿正在审核中, 无法编辑。如需修改请先撤回'
      : '当前状态的投稿无法编辑'
  }

  const updated = await prisma.patch_submission.updateMany({
    where: {
      id: input.submissionId,
      user_id: input.userId,
      revision: input.revision,
      status: { in: [...PATCH_SUBMISSION_EDITABLE_STATUSES] }
    },
    data: {
      payload: input.payload as unknown as Prisma.InputJsonValue,
      name: input.payload.name,
      vndb_id: input.payload.vndbId || null,
      vndb_relation_id: input.payload.vndbRelationId || null,
      bangumi_id: input.payload.bangumiId
        ? Number(input.payload.bangumiId)
        : null,
      steam_id: input.payload.steamId ? Number(input.payload.steamId) : null,
      dlsite_code: input.payload.dlsiteCode || null,
      external_source: input.externalSource || null,
      external_fetched_at: input.externalSource ? new Date() : null,
      revision: { increment: 1 }
    }
  })

  if (updated.count === 0) {
    return '投稿已在其他设备上被修改, 请刷新后重试'
  }

  return { revision: input.revision + 1 }
}

/**
 * Deleting an active draft releases its deposit. Terminal submissions are never
 * deleted through here: they have already been settled, and calling a settlement
 * primitive a second time raises instead of being a no-op.
 */
export const deletePatchSubmissionDraft = async (
  submissionId: number,
  userId: number
) =>
  prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<
        { id: number; status: string; reservation_id: number | null }[]
      >(
        Prisma.sql`
          SELECT id, status, reservation_id
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
        !PATCH_SUBMISSION_ACTIVE_STATUSES.includes(
          submission.status as (typeof PATCH_SUBMISSION_ACTIVE_STATUSES)[number]
        )
      ) {
        throw new PatchSubmissionError(
          '该投稿已结束, 只能从列表中隐藏, 无法删除'
        )
      }
      if (submission.status === 'pending') {
        throw new PatchSubmissionError('投稿正在审核中, 请先撤回再删除')
      }

      let balance = null
      if (submission.reservation_id) {
        const settlement = await releaseMoemoepoint(tx, {
          reservationId: submission.reservation_id,
          reasonCode: PATCH_SUBMISSION_REASON.depositReleased.code,
          reason: `${PATCH_SUBMISSION_REASON.depositReleased.text}：用户删除草稿`,
          idempotencyKey: `patch_submission:${submissionId}:release`
        })
        balance = settlement.balance
      }

      await tx.patch_submission.update({
        where: { id: submissionId },
        data: { status: 'deleted', settled_at: new Date() }
      })

      return { balance }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
  )

/** Terminal records leave the author's list without touching the deposit. */
export const hidePatchSubmission = async (
  submissionId: number,
  userId: number
) => {
  const hidden = await prisma.patch_submission.updateMany({
    where: {
      id: submissionId,
      user_id: userId,
      status: { notIn: [...PATCH_SUBMISSION_ACTIVE_STATUSES] }
    },
    data: { hidden_by_user: true }
  })

  if (hidden.count === 0) {
    return '只有已结束的投稿可以隐藏'
  }
  return {}
}
