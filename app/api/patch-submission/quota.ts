import { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import { reserveMoemoepoint } from '~/app/api/moemoepoint/service'
import {
  PATCH_SUBMISSION_ACTIVE_STATUSES,
  PATCH_SUBMISSION_MAX_TOTAL_BYTES,
  PATCH_SUBMISSION_REASON,
  getPatchSubmissionDeposit
} from '~/constants/patchSubmission'
import type { PatchSubmissionPayload } from '~/types/api/patchSubmission'

type Tx = Prisma.TransactionClient

/**
 * Takes the row lock the whole quota check depends on.
 *
 * The balance guard inside reserveMoemoepoint is atomic on its own, but relying
 * on it to serialize draft creation is wrong twice over: the draft count is a
 * plain SELECT that two transactions can both read as under the cap, and
 * reserveMoemoepoint returns early on a repeated idempotency key without ever
 * touching the user row, so a retry takes no lock at all.
 *
 * Everything that follows in the same transaction therefore sees a consistent
 * view: under READ COMMITTED the count runs after the lock is granted, so it
 * observes rows a competing transaction has just committed.
 */
const lockUserRow = async (tx: Tx, userId: number) => {
  const rows = await tx.$queryRaw<{ id: number; role: number }[]>(
    Prisma.sql`SELECT id, role FROM "user" WHERE id = ${userId} FOR UPDATE`
  )
  const user = rows[0]
  if (!user) {
    throw new PatchSubmissionError('用户不存在')
  }
  return user
}

export class PatchSubmissionError extends Error {}

export const countActiveSubmissions = (tx: Tx, userId: number) =>
  tx.patch_submission.count({
    where: {
      user_id: userId,
      status: { in: [...PATCH_SUBMISSION_ACTIVE_STATUSES] }
    }
  })

/**
 * Bytes held by every active draft. `uploading` rows count too: only counting
 * `ready` would let concurrent uploads walk past the cap between the count and
 * the insert.
 */
export const sumActiveSubmissionBytes = async (tx: Tx, userId: number) => {
  const rows = await tx.$queryRaw<{ total: bigint | null }[]>(
    Prisma.sql`
      SELECT SUM(gallery.declared_bytes)::bigint AS total
      FROM patch_submission_gallery gallery
      JOIN patch_submission submission ON submission.id = gallery.submission_id
      WHERE submission.user_id = ${userId}
        AND submission.status = ANY(${[...PATCH_SUBMISSION_ACTIVE_STATUSES]})
        AND gallery.upload_status <> 'failed'
    `
  )
  return Number(rows[0]?.total ?? 0)
}

interface CreateDraftInput {
  userId: number
  /** Stable per attempt, so a retried request resolves to the same draft. */
  requestId: string
  payload: PatchSubmissionPayload
}

/**
 * Creates a draft and freezes its deposit in one transaction, in the only order
 * that holds under concurrency:
 *
 *   1. lock the user row
 *   2. resolve creation idempotency — a repeat returns the existing draft and
 *      stops, so it can neither count nor reserve a second time
 *   3. check the quota
 *   4. reserve the deposit
 *   5. insert the draft
 */
export const createPatchSubmissionDraft = async (input: CreateDraftInput) =>
  prisma.$transaction(
    async (tx) => {
      const user = await lockUserRow(tx, input.userId)

      const idempotencyKey = `patch_submission:create:${input.userId}:${input.requestId}`
      const existing = await tx.patch_submission.findFirst({
        where: {
          user_id: input.userId,
          reservation: { idempotency_key: idempotencyKey }
        },
        select: { id: true, status: true, revision: true }
      })
      if (existing) {
        return { submission: existing, applied: false as const }
      }

      const deposit = getPatchSubmissionDeposit(user.role)

      const activeCount = await countActiveSubmissions(tx, input.userId)
      if (activeCount >= deposit.maxActive) {
        throw new PatchSubmissionError(
          `您最多同时进行 ${deposit.maxActive} 条投稿, 请先完成或删除已有草稿`
        )
      }

      const usedBytes = await sumActiveSubmissionBytes(tx, input.userId)
      if (usedBytes >= PATCH_SUBMISSION_MAX_TOTAL_BYTES) {
        throw new PatchSubmissionError(
          '您的投稿素材已达到容量上限, 请先删除不需要的草稿'
        )
      }

      const reservation = await reserveMoemoepoint(tx, {
        userId: input.userId,
        amount: deposit.amount,
        reasonCode: PATCH_SUBMISSION_REASON.deposit.code,
        reason: `${PATCH_SUBMISSION_REASON.deposit.text}：${input.payload.name.slice(0, 100)}`,
        referenceType: 'patch_submission',
        idempotencyKey
      })

      const submission = await tx.patch_submission.create({
        data: {
          user_id: input.userId,
          status: 'draft',
          payload: input.payload as unknown as Prisma.InputJsonValue,
          name: input.payload.name,
          vndb_id: input.payload.vndbId || null,
          vndb_relation_id: input.payload.vndbRelationId || null,
          bangumi_id: input.payload.bangumiId
            ? Number(input.payload.bangumiId)
            : null,
          steam_id: input.payload.steamId
            ? Number(input.payload.steamId)
            : null,
          dlsite_code: input.payload.dlsiteCode || null,
          role_at_creation: user.role,
          held_amount: deposit.amount,
          reservation_id: reservation.reservation.id
        },
        select: { id: true, status: true, revision: true }
      })

      await tx.user_moemoepoint_reservation.update({
        where: { id: reservation.reservation.id },
        data: {
          reference_id: String(submission.id),
          link: `/submission/${submission.id}`
        }
      })

      return { submission, applied: true as const, balance: reservation.balance }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
  )
