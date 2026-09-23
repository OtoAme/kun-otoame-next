import type { Prisma } from '@prisma/client'

/**
 * Serializes detect, apply, dismiss, and reopen. The text key is
 * `company-merge-queue`; `pg_advisory_xact_lock` only accepts integers, so
 * the bigint is `hashtextextended` of that string. The lock ends with the
 * transaction.
 */
export const COMPANY_MERGE_ADVISORY_LOCK_SQL =
  "SELECT pg_advisory_xact_lock(hashtextextended('company-merge-queue', 0))"

export const lockCompanyMergeQueue = async (tx: Prisma.TransactionClient) => {
  await tx.$executeRawUnsafe(COMPANY_MERGE_ADVISORY_LOCK_SQL)
}

/**
 * Lock suggestion rows for these member keys in ascending string order.
 * Missing keys lock nothing. Call this only after `lockCompanyMergeQueue`.
 */
export const lockCompanyMergeSuggestionRows = async (
  tx: Prisma.TransactionClient,
  memberKeys: readonly string[]
) => {
  const keys = [
    ...new Set(
      memberKeys.map((key) => key.trim()).filter((key) => key.length > 0)
    )
  ].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  for (const memberKey of keys) {
    await tx.$queryRawUnsafe(
      'SELECT id FROM company_merge_suggestion WHERE member_key = $1 ORDER BY member_key ASC FOR UPDATE',
      memberKey
    )
  }
}
