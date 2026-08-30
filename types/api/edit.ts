import type { MoemoepointBalance } from './moemoepoint'

export type EditPostCommitWarning = {
  kind: 'company-ambiguity' | 'external-data-error'
  message: string
}

export type EditPostCommitResult = {
  warnings: EditPostCommitWarning[]
}

export type CreatePatchResult = EditPostCommitResult & {
  uniqueId: string
  patchId: number
  moemoepointBalance: MoemoepointBalance
}

export type RewritePatchResult = EditPostCommitResult
