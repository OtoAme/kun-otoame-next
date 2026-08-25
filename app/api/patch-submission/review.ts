import { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import { createMessage } from '~/app/api/utils/message'
import {
  forfeitMoemoepoint,
  earnMoemoepoint,
  releaseMoemoepoint
} from '~/app/api/moemoepoint/service'
import {
  PATCH_SUBMISSION_PUBLISH_REWARD,
  PATCH_SUBMISSION_REASON,
  PATCH_SUBMISSION_REVIEW_MIN_ROLE
} from '~/constants/patchSubmission'
import { takeDownSubmissionAssets } from './assetCleanup'
import { publishSubmissionCore, runPublishSideEffects } from './publishCore'
import { PatchSubmissionError } from './quota'
import type { PatchSubmissionPayload } from '~/types/api/patchSubmission'

interface Reviewer {
  uid: number
  name: string
  role: number
}

const assertCanReview = (reviewer: Reviewer) => {
  if (reviewer.role < PATCH_SUBMISSION_REVIEW_MIN_ROLE) {
    throw new PatchSubmissionError('您没有审核投稿的权限')
  }
}

/**
 * Self-review is refused, because approving your own submission would let one
 * account mint entries and collect the reward unchecked. A super admin can still
 * force it — a submission left behind by someone who was promoted afterwards
 * would otherwise have nobody to handle it — but the override has to be explicit
 * and it is logged loudly.
 */
const assertNotSelfReview = (
  reviewer: Reviewer,
  authorId: number,
  override: boolean
) => {
  if (reviewer.uid !== authorId) {
    return false
  }
  if (reviewer.role < 4 || !override) {
    throw new PatchSubmissionError('不能审核自己的投稿')
  }
  return true
}

const writeAdminLog = (
  tx: Prisma.TransactionClient,
  reviewer: Reviewer,
  content: string
) =>
  tx.admin_log.create({
    data: { type: 'update', user_id: reviewer.uid, content }
  })

const loadPendingSubmission = async (
  tx: Prisma.TransactionClient,
  submissionId: number
) => {
  const submission = await tx.patch_submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      user_id: true,
      status: true,
      name: true,
      payload: true,
      held_amount: true,
      reservation_id: true,
      banner_key: true,
      banner_thumbnail_key: true,
      banner_original_key: true,
      gallery: {
        where: { upload_status: 'ready' },
        orderBy: { display_order: 'asc' },
        select: {
          image_key: true,
          thumbnail_key: true,
          is_nsfw: true,
          display_order: true
        }
      }
    }
  })
  if (!submission) {
    throw new PatchSubmissionError('投稿不存在')
  }
  if (submission.status !== 'pending') {
    throw new PatchSubmissionError('该投稿当前不在待审核状态')
  }
  return submission
}

/**
 * Claims the submission with a single conditional update. Two reviewers pressing
 * approve at the same time therefore produce one patch: the loser's update
 * matches no row. This is the only concurrency guard in the approval path and it
 * must not be removed.
 */
const claimPending = async (
  tx: Prisma.TransactionClient,
  submissionId: number,
  data: Prisma.patch_submissionUncheckedUpdateManyInput
) => {
  const claimed = await tx.patch_submission.updateMany({
    where: { id: submissionId, status: 'pending' },
    data
  })
  if (claimed.count === 0) {
    throw new PatchSubmissionError('该投稿已被其他管理员处理')
  }
}

export const approvePatchSubmission = async (
  submissionId: number,
  reviewer: Reviewer,
  overrideSelfReview: boolean
) => {
  assertCanReview(reviewer)

  const result = await prisma.$transaction(
    async (tx) => {
      const submission = await loadPendingSubmission(tx, submissionId)
      const overrode = assertNotSelfReview(
        reviewer,
        submission.user_id,
        overrideSelfReview
      )
      const payload = submission.payload as unknown as PatchSubmissionPayload

      const patch = await publishSubmissionCore(tx, {
        authorId: submission.user_id,
        payload,
        bannerKey: submission.banner_key,
        gallery: submission.gallery
          .filter((image) => image.image_key)
          .map((image) => ({
            key: image.image_key as string,
            thumbnailKey: image.thumbnail_key,
            isNSFW: image.is_nsfw,
            displayOrder: image.display_order
          }))
      })

      let balance = null
      if (submission.reservation_id) {
        const released = await releaseMoemoepoint(tx, {
          reservationId: submission.reservation_id,
          reasonCode: PATCH_SUBMISSION_REASON.depositReleased.code,
          reason: `${PATCH_SUBMISSION_REASON.depositReleased.text}：投稿通过`,
          idempotencyKey: `patch_submission:${submissionId}:release`,
          operatorId: reviewer.uid
        })
        balance = released.balance
      }

      const rewarded = await earnMoemoepoint(tx, {
        userId: submission.user_id,
        amount: PATCH_SUBMISSION_PUBLISH_REWARD,
        reasonCode: PATCH_SUBMISSION_REASON.publishReward.code,
        reason: `${PATCH_SUBMISSION_REASON.publishReward.text}：${submission.name.slice(0, 100)}`,
        referenceType: 'patch_submission',
        referenceId: submissionId,
        link: `/${patch.unique_id}`,
        idempotencyKey: `patch_submission:${submissionId}:publish-reward`
      })

      await claimPending(tx, submissionId, {
        status: 'published',
        patch_id: patch.id,
        reviewed_by_id: reviewer.uid,
        reviewed_at: new Date(),
        settled_at: new Date(),
        review_reason: null
      })

      await createMessage(
        {
          type: 'system',
          content: `您的投稿《${submission.name}》已通过审核, 押金已返还并奖励 ${PATCH_SUBMISSION_PUBLISH_REWARD} 萌萌点`,
          recipient_id: submission.user_id,
          link: `/${patch.unique_id}`
        },
        tx
      )

      await writeAdminLog(
        tx,
        reviewer,
        `${overrode ? '【超级管理员自审 override】' : ''}管理员 ${reviewer.name} 通过了投稿《${submission.name}》(投稿 ID: ${submissionId}), 生成游戏 ${patch.unique_id}`
      )

      return {
        uniqueId: patch.unique_id,
        contentLimit: payload.contentLimit,
        balance: rewarded.balance ?? balance,
        touchedCompanies:
          payload.vndbDevelopers.length > 0 ||
          payload.bangumiDevelopers.length > 0 ||
          payload.steamDevelopers.length > 0 ||
          Boolean(payload.dlsiteCircleName)
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
  )

  await runPublishSideEffects(result)

  return { uniqueId: result.uniqueId, moemoepointBalance: result.balance }
}

/**
 * A duplicate entry, something out of scope, or an honest submission that cannot
 * be published. The deposit comes back: this is not a punishment. Without this
 * action a reviewer would only be able to leave the submission pending forever
 * or punish it unfairly.
 */
export const rejectPatchSubmission = async (
  submissionId: number,
  reviewer: Reviewer,
  reason: string,
  overrideSelfReview: boolean
) => {
  assertCanReview(reviewer)

  const result = await prisma.$transaction(
    async (tx) => {
      const submission = await loadPendingSubmission(tx, submissionId)
      const overrode = assertNotSelfReview(
        reviewer,
        submission.user_id,
        overrideSelfReview
      )

      let balance = null
      if (submission.reservation_id) {
        const released = await releaseMoemoepoint(tx, {
          reservationId: submission.reservation_id,
          reasonCode: PATCH_SUBMISSION_REASON.depositReleased.code,
          reason: `${PATCH_SUBMISSION_REASON.depositReleased.text}：投稿被驳回`,
          idempotencyKey: `patch_submission:${submissionId}:release`,
          operatorId: reviewer.uid
        })
        balance = released.balance
      }

      await claimPending(tx, submissionId, {
        status: 'rejected',
        reviewed_by_id: reviewer.uid,
        reviewed_at: new Date(),
        settled_at: new Date(),
        review_reason: reason
      })

      await createMessage(
        {
          type: 'system',
          content: `您的投稿《${submission.name}》未被收录, 押金已全额返还。原因: ${reason}`,
          recipient_id: submission.user_id,
          link: `/submission/${submissionId}`
        },
        tx
      )

      await writeAdminLog(
        tx,
        reviewer,
        `${overrode ? '【超级管理员自审 override】' : ''}管理员 ${reviewer.name} 驳回了投稿《${submission.name}》(投稿 ID: ${submissionId}), 押金已返还。原因: ${reason}`
      )

      return { balance }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
  )

  await takeDownSubmissionAssets(submissionId)

  return { moemoepointBalance: result.balance }
}

/** Sends the draft back for edits. Nothing is settled: the deposit stays put. */
export const requestPatchSubmissionChanges = async (
  submissionId: number,
  reviewer: Reviewer,
  reason: string,
  overrideSelfReview: boolean
) => {
  assertCanReview(reviewer)

  return prisma.$transaction(
    async (tx) => {
      const submission = await loadPendingSubmission(tx, submissionId)
      const overrode = assertNotSelfReview(
        reviewer,
        submission.user_id,
        overrideSelfReview
      )

      await claimPending(tx, submissionId, {
        status: 'changes_requested',
        reviewed_by_id: reviewer.uid,
        reviewed_at: new Date(),
        review_reason: reason
      })

      await createMessage(
        {
          type: 'system',
          content: `您的投稿《${submission.name}》需要修改后重新提交。原因: ${reason}`,
          recipient_id: submission.user_id,
          link: `/submission/${submissionId}`
        },
        tx
      )

      await writeAdminLog(
        tx,
        reviewer,
        `${overrode ? '【超级管理员自审 override】' : ''}管理员 ${reviewer.name} 要求修改投稿《${submission.name}》(投稿 ID: ${submissionId})。原因: ${reason}`
      )

      return {}
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
  )
}

/** Rule breaking. The deposit is kept, and the content is cleared. */
export const violatePatchSubmission = async (
  submissionId: number,
  reviewer: Reviewer,
  reason: string,
  overrideSelfReview: boolean
) => {
  assertCanReview(reviewer)

  const result = await prisma.$transaction(
    async (tx) => {
      const submission = await loadPendingSubmission(tx, submissionId)
      const overrode = assertNotSelfReview(
        reviewer,
        submission.user_id,
        overrideSelfReview
      )

      let balance = null
      if (submission.reservation_id) {
        const forfeited = await forfeitMoemoepoint(tx, {
          reservationId: submission.reservation_id,
          reasonCode: PATCH_SUBMISSION_REASON.depositForfeited.code,
          reason: `${PATCH_SUBMISSION_REASON.depositForfeited.text}：${reason.slice(0, 200)}`,
          idempotencyKey: `patch_submission:${submissionId}:forfeit`,
          operatorId: reviewer.uid
        })
        balance = forfeited.balance
      }

      // User content is erased immediately. Asset keys and gallery rows remain
      // hidden as the durable cleanup credential until S3 deletion and CDN
      // purge are both confirmed.
      await claimPending(tx, submissionId, {
        status: 'violation',
        reviewed_by_id: reviewer.uid,
        reviewed_at: new Date(),
        settled_at: new Date(),
        review_reason: reason,
        payload: {} as Prisma.InputJsonValue
      })

      await createMessage(
        {
          type: 'system',
          content: `您的投稿《${submission.name}》因违规被关闭, 暂扣的 ${submission.held_amount} 萌萌点不再返还。原因: ${reason}`,
          recipient_id: submission.user_id,
          link: `/submission/${submissionId}`
        },
        tx
      )

      await writeAdminLog(
        tx,
        reviewer,
        `${overrode ? '【超级管理员自审 override】' : ''}管理员 ${reviewer.name} 判定投稿《${submission.name}》违规 (投稿 ID: ${submissionId}), 扣除 ${submission.held_amount} 萌萌点。原因: ${reason}`
      )

      return { balance }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
  )

  await takeDownSubmissionAssets(submissionId)

  return { moemoepointBalance: result.balance }
}
