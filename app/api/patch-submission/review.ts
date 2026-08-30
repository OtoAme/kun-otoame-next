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
  PATCH_SUBMISSION_REVIEW_MIN_ROLE,
  PATCH_SUBMISSION_REVIEW_STATE_CHANGED_MESSAGE
} from '~/constants/patchSubmission'
import { takeDownSubmissionAssets } from './assetCleanup'
import { publishSubmissionCore, runPublishSideEffects } from './publishCore'
import { PatchSubmissionError } from './quota'
import { decodePatchSubmissionPayload } from './payloadCodec'
import { collectPatchSubmissionCompanyCandidates } from './companyCandidates'
import {
  isCompanyIdentityConstraintError,
  runWithCompanyIdentityConstraintRetry
} from '~/app/api/company/identity/retry'
import type { CompanyResolutionDiagnostic } from '~/app/api/company/identity/resolver'

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
      company_candidates: true,
      held_amount: true,
      reservation_id: true,
      banner_key: true,
      banner_thumbnail_key: true,
      banner_original_key: true,
      gallery: {
        where: { upload_status: 'ready' },
        orderBy: [{ display_order: 'asc' }, { id: 'asc' }],
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
    throw new PatchSubmissionError(
      PATCH_SUBMISSION_REVIEW_STATE_CHANGED_MESSAGE
    )
  }
  return submission
}

/**
 * Claims the submission with a single conditional update. A competing reviewer
 * or an author withdrawal can therefore win the state transition, but never
 * publish the same submission afterwards. This is the final concurrency guard
 * in the approval path and it must not be removed.
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
    throw new PatchSubmissionError(
      PATCH_SUBMISSION_REVIEW_STATE_CHANGED_MESSAGE
    )
  }
}

/**
 * publishSubmissionCore inserts the patch under the same unique external-id
 * constraints as any entry (`vndb_relation_id`, `[vndb_id, vndb_relation_id]`,
 * `bangumi_id`, `dlsite_code`). Approving a submission whose external id already
 * belongs to a published game raises a Prisma P2002 that would otherwise surface
 * as a 500. Turn it into a reviewer-facing message — the transaction rolls back,
 * so the submission stays pending and the deposit is untouched, and the reviewer
 * can reject it as a duplicate instead.
 */
const duplicateExternalIdMessage = (
  error: Prisma.PrismaClientKnownRequestError
): string | null => {
  if (error.code !== 'P2002') {
    return null
  }
  const target = Array.isArray(error.meta?.target)
    ? (error.meta.target as string[]).join(',')
    : String(error.meta?.target ?? '')
  if (target.includes('vndb_relation_id') || target.includes('vndb_id')) {
    return '该游戏的 VNDB ID / Release ID 已存在对应条目, 无法重复发布, 请核对后驳回该投稿'
  }
  if (target.includes('bangumi_id')) {
    return '该游戏的 Bangumi ID 已存在对应条目, 无法重复发布, 请核对后驳回该投稿'
  }
  if (target.includes('dlsite_code')) {
    return '该游戏的 DLsite 编号已存在对应条目, 无法重复发布, 请核对后驳回该投稿'
  }
  return '该游戏的外部 ID 已被其他条目占用, 无法重复发布, 请核对后驳回该投稿'
}

const writeCompanyResolutionDiagnosticLogs = async (
  tx: Prisma.TransactionClient,
  reviewer: Reviewer,
  submissionId: number,
  diagnostics: CompanyResolutionDiagnostic[]
) => {
  for (const diagnostic of diagnostics) {
    const candidate = diagnostic.candidate
    const matches = diagnostic.matchedCompanies
      .map((company) => `#${company.id} ${company.name}`)
      .join('、')
    await writeAdminLog(
      tx,
      reviewer,
      `投稿 #${submissionId} 会社身份诊断 external-id-name-conflict：${candidate.source}:${candidate.externalId || '无外部 ID'}:${candidate.name} → ${matches}`.slice(
        0,
        10007
      )
    )
  }
}

export const approvePatchSubmission = async (
  submissionId: number,
  reviewer: Reviewer,
  overrideSelfReview: boolean
) => {
  assertCanReview(reviewer)

  let result: {
    uniqueId: string
    contentLimit: string
    balance: Awaited<ReturnType<typeof earnMoemoepoint>>['balance'] | null
    touchedCompanies: boolean
  }
  try {
    result = await runWithCompanyIdentityConstraintRetry((attempt) =>
      prisma.$transaction(
        async (tx) => {
          const submission = await loadPendingSubmission(tx, submissionId)
          const overrode = assertNotSelfReview(
            reviewer,
            submission.user_id,
            overrideSelfReview
          )
          const decodedPayload = decodePatchSubmissionPayload(
            submission.payload,
            { complete: true }
          )
          if (!decodedPayload.success) {
            throw new PatchSubmissionError(
              `投稿内容无法发布：${decodedPayload.message}`
            )
          }
          const payload = decodedPayload.data
          const companyCandidates = collectPatchSubmissionCompanyCandidates({
            payload,
            snapshots: submission.company_candidates
          })

          const patch = await publishSubmissionCore(tx, {
            authorId: submission.user_id,
            payload,
            bannerKey: submission.banner_key,
            companyCandidates: companyCandidates.candidates,
            constraintCompatibility: attempt > 1,
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
          await writeCompanyResolutionDiagnosticLogs(
            tx,
            reviewer,
            submissionId,
            patch.companyResolutionDiagnostics ?? []
          )

          return {
            uniqueId: patch.unique_id,
            contentLimit: payload.contentLimit,
            balance: rewarded.balance ?? balance,
            touchedCompanies:
              patch.touchedCompanies ??
              (payload.vndbDevelopers.length > 0 ||
                payload.bangumiDevelopers.length > 0 ||
                payload.steamDevelopers.length > 0 ||
                Boolean(payload.dlsiteCircleName))
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
      )
    )
  } catch (error) {
    if (isCompanyIdentityConstraintError(error)) {
      throw new PatchSubmissionError(
        '会社身份在并发写入后仍无法收敛, 请刷新详情并重试审核'
      )
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const message = duplicateExternalIdMessage(error)
      if (message) {
        throw new PatchSubmissionError(message)
      }
    }
    throw error
  }

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
