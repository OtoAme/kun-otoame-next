import type { PatchSubmissionStatus } from '~/types/api/patchSubmission'

/**
 * Deposit terms per role. Both the amount and the cap are read at creation time
 * and then frozen on the row, so promoting or demoting a user never re-settles
 * an existing submission. A demoted user keeps working on drafts they already
 * have but cannot start new ones past the lower cap.
 */
export const PATCH_SUBMISSION_DEPOSIT = {
  /** role 1 */
  user: { amount: 10, maxActive: 5 },
  /** role >= 2 */
  creator: { amount: 1, maxActive: 10 }
} as const

export const PATCH_SUBMISSION_PUBLISH_REWARD = 3

export const PATCH_SUBMISSION_REVIEW_MIN_ROLE = 3

export const PATCH_SUBMISSION_REASON_MAX_LENGTH = 1007

export const PATCH_SUBMISSION_GALLERY_MAX_COUNT = 20

/**
 * Total bytes one user's active drafts may hold.
 *
 * A draft count alone cannot bound storage: 20 images x 8 MB x 5 drafts is
 * roughly 800 MB for a regular user and twice that for a creator, and the first
 * release never expires drafts automatically. 200 MB still allows a full
 * 20-image gallery at realistic sizes while keeping the worst case bounded.
 */
export const PATCH_SUBMISSION_MAX_TOTAL_BYTES = 200 * 1024 * 1024

/**
 * An upload row that never reached `ready` stops holding its slot after this,
 * so a crashed request cannot occupy a submission's quota forever. The same
 * client_asset_id may then take it over.
 */
export const PATCH_SUBMISSION_UPLOAD_TAKEOVER_MS = 10 * 60 * 1000

/** Only these hold a slot and keep the deposit reserved. */
export const PATCH_SUBMISSION_ACTIVE_STATUSES = [
  'draft',
  'pending',
  'changes_requested'
] as const satisfies readonly PatchSubmissionStatus[]

/** Settled once on entry; afterwards the author can only hide the record. */
export const PATCH_SUBMISSION_TERMINAL_STATUSES = [
  'rejected',
  'published',
  'violation',
  'deleted'
] as const satisfies readonly PatchSubmissionStatus[]

/** Editable by the author. */
export const PATCH_SUBMISSION_EDITABLE_STATUSES = [
  'draft',
  'changes_requested'
] as const satisfies readonly PatchSubmissionStatus[]

export const PATCH_SUBMISSION_REASON = {
  deposit: {
    code: 'patch_submission.deposit',
    text: '投稿押金暂扣'
  },
  depositReleased: {
    code: 'patch_submission.deposit_release',
    text: '投稿押金返还'
  },
  depositForfeited: {
    code: 'patch_submission.deposit_forfeit',
    text: '投稿违规, 押金扣除'
  },
  publishReward: {
    code: 'patch_submission.publish_reward',
    text: '投稿通过奖励'
  }
} as const

export const getPatchSubmissionDeposit = (role: number) =>
  role >= 2 ? PATCH_SUBMISSION_DEPOSIT.creator : PATCH_SUBMISSION_DEPOSIT.user
