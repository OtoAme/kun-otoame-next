import { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import { PATCH_SUBMISSION_ACTIVE_STATUSES } from '~/constants/patchSubmission'
import { PATCH_SUBMISSION_GALLERY_MAX_COUNT } from '~/constants/patchSubmission'
import { patchSubmissionPayloadSchema } from '~/validations/patchSubmission'
import { PatchSubmissionError } from './quota'
import type { PatchSubmissionPayload } from '~/types/api/patchSubmission'

/**
 * Hard duplicate checks, scoped to this author's own active drafts.
 *
 * This is not the final defense: two different users may hold pending
 * submissions for the same game on purpose, and whoever gets approved first
 * wins. The database unique constraints decide that at approval time. Checking
 * here only stops one author from queueing the same entry twice.
 */
const findOwnDuplicate = async (
  userId: number,
  submissionId: number,
  payload: PatchSubmissionPayload
) => {
  const hardFields: { label: string; where: Prisma.patch_submissionWhereInput }[] =
    []

  if (payload.vndbRelationId) {
    hardFields.push({
      label: 'Release ID',
      where: { vndb_relation_id: payload.vndbRelationId }
    })
  }
  if (payload.bangumiId) {
    hardFields.push({
      label: 'Bangumi ID',
      where: { bangumi_id: Number(payload.bangumiId) }
    })
  }
  if (payload.dlsiteCode) {
    hardFields.push({
      label: 'DLSite Code',
      where: { dlsite_code: payload.dlsiteCode }
    })
  }

  for (const field of hardFields) {
    const existing = await prisma.patch_submission.findFirst({
      where: {
        user_id: userId,
        id: { not: submissionId },
        status: { in: [...PATCH_SUBMISSION_ACTIVE_STATUSES] },
        ...field.where
      },
      select: { id: true }
    })
    if (existing) {
      return `您已有一条进行中的投稿使用了相同的 ${field.label}, 请先处理那一条`
    }
  }

  return null
}

/** A published entry with the same hard id means this submission cannot land. */
const findPublishedConflict = async (payload: PatchSubmissionPayload) => {
  if (payload.vndbRelationId) {
    const patch = await prisma.patch.findFirst({
      where: { vndb_relation_id: payload.vndbRelationId },
      select: { unique_id: true }
    })
    if (patch) {
      return `Release ID 与已收录的游戏 ${patch.unique_id} 重复`
    }
  }
  if (payload.bangumiId) {
    const patch = await prisma.patch.findFirst({
      where: { bangumi_id: Number(payload.bangumiId) },
      select: { unique_id: true }
    })
    if (patch) {
      return `Bangumi ID 与已收录的游戏 ${patch.unique_id} 重复`
    }
  }
  if (payload.dlsiteCode) {
    const patch = await prisma.patch.findFirst({
      where: { dlsite_code: payload.dlsiteCode },
      select: { unique_id: true }
    })
    if (patch) {
      return `DLSite Code 与已收录的游戏 ${patch.unique_id} 重复`
    }
  }
  return null
}

/**
 * draft | changes_requested -> pending. The payload is already stored by
 * autosave; submitting freezes it by locking the row against further edits, so
 * what a reviewer reads is exactly what gets published.
 */
export const submitPatchSubmission = async (
  submissionId: number,
  userId: number
) => {
  const submission = await prisma.patch_submission.findFirst({
    where: { id: submissionId, user_id: userId },
    select: {
      status: true,
      payload: true,
      banner_key: true,
      gallery: { select: { upload_status: true } }
    }
  })
  if (!submission) {
    return '投稿不存在'
  }
  if (submission.status === 'pending') {
    return '投稿已提交, 正在等待审核'
  }
  if (submission.status !== 'draft' && submission.status !== 'changes_requested') {
    return '当前状态的投稿无法提交'
  }
  if (!submission.banner_key) {
    return '请先上传封面图片'
  }

  const pendingUploads = submission.gallery.filter(
    (image) => image.upload_status === 'uploading'
  ).length
  if (pendingUploads > 0) {
    return `还有 ${pendingUploads} 张截图正在上传, 请等待上传完成`
  }
  const readyUploads = submission.gallery.filter(
    (image) => image.upload_status === 'ready'
  ).length
  if (readyUploads > PATCH_SUBMISSION_GALLERY_MAX_COUNT) {
    return `截图最多 ${PATCH_SUBMISSION_GALLERY_MAX_COUNT} 张`
  }

  const payload = submission.payload as unknown as PatchSubmissionPayload

  // Drafts are saved while incomplete, so completeness is checked here rather
  // than on every autosave.
  const complete = patchSubmissionPayloadSchema.safeParse(payload)
  if (!complete.success) {
    return complete.error.errors[0]?.message ?? '投稿内容不完整'
  }

  const ownDuplicate = await findOwnDuplicate(userId, submissionId, payload)
  if (ownDuplicate) {
    return ownDuplicate
  }
  const publishedConflict = await findPublishedConflict(payload)
  if (publishedConflict) {
    return publishedConflict
  }

  const submitted = await prisma.patch_submission.updateMany({
    where: {
      id: submissionId,
      user_id: userId,
      status: { in: ['draft', 'changes_requested'] }
    },
    data: {
      status: 'pending',
      submitted_at: new Date(),
      review_reason: null,
      revision: { increment: 1 }
    }
  })
  if (submitted.count === 0) {
    return '投稿状态已变化, 请刷新后重试'
  }

  return {}
}

/**
 * pending -> draft. Nothing is settled: the deposit stays reserved with the
 * draft. Getting it back means deleting the draft afterwards, which the UI has
 * to say plainly.
 */
export const withdrawPatchSubmission = async (
  submissionId: number,
  userId: number
) => {
  const withdrawn = await prisma.patch_submission.updateMany({
    where: { id: submissionId, user_id: userId, status: 'pending' },
    data: { status: 'draft', submitted_at: null, revision: { increment: 1 } }
  })

  if (withdrawn.count === 0) {
    const exists = await prisma.patch_submission.findFirst({
      where: { id: submissionId, user_id: userId },
      select: { status: true }
    })
    if (!exists) {
      throw new PatchSubmissionError('投稿不存在')
    }
    return '只有审核中的投稿可以撤回'
  }

  return {}
}
