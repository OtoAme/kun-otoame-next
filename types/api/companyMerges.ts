const KIND_LABELS: Record<string, string> = {
  'suffix-unique-hit': '仅法人格后缀不同',
  'name-variant': '名称变体（标点 / 括号注音 / 法人格）'
}

/** The column vocabulary; this queue only ever serves `pending` rows. */
export type CompanyMergeSuggestionStatus = 'pending' | 'dismissed' | 'accepted'

/**
 * One company of a queued cluster, as it looked when the list was read. Every
 * field is nullable-ish because detection can be older than the company table:
 * `name === null` means that company is already gone, and the merge dialog has
 * to refuse rather than submit a cluster that no longer exists.
 */
export interface CompanyMergeParticipant {
  companyId: number
  name: string | null
  aliases: string[]
  /** 介绍开头, 已折叠空白并截断; 空串表示没有介绍。 */
  introductionPreview: string
  ownerId: number | null
  officialWebsites: string[]
  parentBrands: string[]
}

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
  /** 与 `[targetCompanyId, ...sourceCompanyIds]` 同序。 */
  participants: CompanyMergeParticipant[]
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

export interface CompanyMergeApplyResponse {
  id: number
  targetCompanyId: number
  /** `already-applied` 表示这次合并在上一次请求里已经写进数据库。 */
  databaseStatus: 'applied' | 'already-applied'
  /** 合并已提交, 但缓存失效失败; 只提示运维, 不回滚数据。 */
  cacheWarning?: string
}

export const getCompanyMergeSuggestionKindLabel = (kind: string) =>
  KIND_LABELS[kind] ?? kind
