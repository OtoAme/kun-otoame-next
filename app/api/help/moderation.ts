import type { Prisma } from '@prisma/client'
import { createMessage } from '~/app/api/utils/message'
import {
  HELP_AUTO_HIDE_REPORTER_THRESHOLD,
  HELP_REPORTER_ELIGIBLE_AFTER_MS
} from '~/constants/help'

type Tx = Prisma.TransactionClient
export type HelpModerationTarget = 'help' | 'help_answer' | 'help_reply'

/**
 * Report-side primitives the case service calls inside its own transaction.
 * They only change the help row; the case keeps its own state, `hidden_at`
 * and `restored_at` (03 §12.2「求助举报」).
 */

const lockPost = async (tx: Tx, postId: number) => {
  const rows = await tx.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM help_post WHERE id = ${postId} FOR UPDATE
  `
  return rows.length > 0
}

const loadTargetRow = async (
  tx: Tx,
  targetType: HelpModerationTarget,
  targetId: number
) => {
  if (targetType === 'help') {
    const post = await tx.help_post.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        user_id: true,
        hidden_at: true,
        deleted_at: true
      }
    })
    return post ? { postId: post.id, ...post } : null
  }
  if (targetType === 'help_reply') {
    const reply = await tx.help_reply.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        answer_id: true,
        user_id: true,
        hidden_at: true,
        deleted_at: true,
        answer: { select: { post_id: true } }
      }
    })
    return reply
      ? {
          postId: reply.answer.post_id,
          answerId: reply.answer_id,
          id: reply.id,
          user_id: reply.user_id,
          hidden_at: reply.hidden_at,
          deleted_at: reply.deleted_at
        }
      : null
  }
  const answer = await tx.help_answer.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      post_id: true,
      user_id: true,
      hidden_at: true,
      deleted_at: true
    }
  })
  return answer
    ? { postId: answer.post_id, answerId: answer.id, ...answer }
    : null
}

const targetLink = (
  postId: number,
  targetType: HelpModerationTarget,
  id: number,
  answerId?: number
) =>
  targetType === 'help'
    ? `/help/${postId}`
    : targetType === 'help_reply'
      ? `/help/${postId}#reply-${id}`
      : `/help/${postId}#answer-${answerId ?? id}`

const SUBJECTS: Record<HelpModerationTarget, string> = {
  help: '您的求助',
  help_answer: '您的求助回答',
  help_reply: '您的求助回复'
}

const notifyAuthor = async (
  tx: Tx,
  authorId: number | null,
  targetType: HelpModerationTarget,
  postId: number,
  id: number,
  action: 'hide' | 'restore'
) => {
  if (authorId === null) return
  const subject = SUBJECTS[targetType]
  await createMessage(
    {
      type: 'report',
      content:
        action === 'hide'
          ? `${subject}因举报已被暂时隐藏，等待网站管理员处理`
          : `${subject}经网站管理员复核后已恢复显示`,
      recipient_id: authorId,
      link: targetLink(postId, targetType, id)
    },
    tx
  )
}

/** Hide the target if it is visible. Returns whether this call hid it. */
export const hideHelpTargetForCase = async (
  tx: Tx,
  targetType: HelpModerationTarget,
  targetId: number,
  now: Date
) => {
  const row = await loadTargetRow(tx, targetType, targetId)
  if (!row) return false
  await lockPost(tx, row.postId)
  const where = { id: targetId, hidden_at: null, deleted_at: null }
  const changed =
    targetType === 'help'
      ? await tx.help_post.updateMany({ where, data: { hidden_at: now } })
      : targetType === 'help_reply'
        ? await tx.help_reply.updateMany({ where, data: { hidden_at: now } })
        : await tx.help_answer.updateMany({ where, data: { hidden_at: now } })
  if (changed.count !== 1) return false
  if (targetType === 'help_answer') {
    // A hidden answer cannot stay accepted: the post goes back to open. The
    // one-time reward already paid is history and stays.
    await tx.help_post.updateMany({
      where: { id: row.postId, accepted_answer_id: targetId },
      data: { accepted_answer_id: null, status: 'open' }
    })
  }
  await notifyAuthor(tx, row.user_id, targetType, row.postId, targetId, 'hide')
  return true
}

/** Undo a hide. Returns whether the target was hidden and is now visible. */
export const restoreHelpTargetForCase = async (
  tx: Tx,
  targetType: HelpModerationTarget,
  targetId: number
) => {
  const row = await loadTargetRow(tx, targetType, targetId)
  if (!row) return false
  await lockPost(tx, row.postId)
  const where = { id: targetId, hidden_at: { not: null } }
  const changed =
    targetType === 'help'
      ? await tx.help_post.updateMany({ where, data: { hidden_at: null } })
      : targetType === 'help_reply'
        ? await tx.help_reply.updateMany({ where, data: { hidden_at: null } })
        : await tx.help_answer.updateMany({ where, data: { hidden_at: null } })
  if (changed.count !== 1) return false
  await notifyAuthor(
    tx,
    row.user_id,
    targetType,
    row.postId,
    targetId,
    'restore'
  )
  return true
}

/** Whether the target row is currently hidden (null when it is gone). */
export const isHelpTargetHidden = async (
  tx: Tx,
  targetType: HelpModerationTarget,
  targetId: number
) => {
  const row = await loadTargetRow(tx, targetType, targetId)
  if (!row || row.deleted_at) return null
  return row.hidden_at !== null
}

/**
 * Subscribers on this case who were registered for at least seven days when
 * they reported. A finished case clears its dedup key, so a new report round
 * opens a new case and old reporters do not count toward it.
 */
export const countEligibleHelpReporters = async (tx: Tx, caseId: number) => {
  const rows = await tx.$queryRaw<Array<{ count: bigint | number }>>`
    SELECT COUNT(*) AS count
    FROM ops_case_subscriber AS subscriber
    JOIN "user" AS reporter ON reporter.id = subscriber.user_id
    WHERE subscriber.case_id = ${caseId}
      AND reporter.register_time <= subscriber.created
        - make_interval(secs => ${HELP_REPORTER_ELIGIBLE_AFTER_MS / 1000})
  `
  return Number(rows[0]?.count ?? 0)
}

/** Case-side threshold: hide on the third eligible reporter in this round. */
export const applyHelpReportThreshold = async (
  tx: Tx,
  targetType: HelpModerationTarget,
  targetId: number,
  caseId: number,
  now: Date
) => {
  const count = await countEligibleHelpReporters(tx, caseId)
  if (count < HELP_AUTO_HIDE_REPORTER_THRESHOLD) return false
  return hideHelpTargetForCase(tx, targetType, targetId, now)
}
