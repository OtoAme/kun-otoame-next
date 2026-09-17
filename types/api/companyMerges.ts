const KIND_LABELS: Record<string, string> = {
  'suffix-unique-hit': '仅法人格后缀不同'
}

/** The column vocabulary; this queue only ever serves `pending` rows. */
export type CompanyMergeSuggestionStatus = 'pending' | 'dismissed' | 'accepted'

/**
 * One row of the merge queue. `names` follows cluster order — the target name
 * first, then the sources — so `names[index + 1]` belongs to
 * `sourceCompanyIds[index]`.
 */
export interface CompanyMergeSuggestion {
  id: number
  kind: string
  status: CompanyMergeSuggestionStatus
  foldedKey: string
  targetCompanyId: number
  sourceCompanyIds: number[]
  names: string[]
  detectedAt: string
}

export interface CompanyMergeSuggestionListResponse {
  items: CompanyMergeSuggestion[]
}

export interface CompanyMergeDetectResponse {
  /** Keys written as new pending rows. */
  created: number
  /** Keys whose pending row was refreshed with the latest cluster. */
  updated: number
  /** Keys left alone because the operator already dismissed them. */
  skipped: number
}

export interface CompanyMergeDismissResponse {
  id: number
}

export const getCompanyMergeSuggestionKindLabel = (kind: string) =>
  KIND_LABELS[kind] ?? kind
