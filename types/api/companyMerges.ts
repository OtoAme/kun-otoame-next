const KIND_LABELS: Record<string, string> = {
  'suffix-unique-hit': '去除公司后缀后名称一致',
  'name-variant': '标点、括号、公司后缀或中外文连写不同',
  'source-pair': '同一作品在 VNDB 或 NextMoe 中的名称相对应'
}

const RESOLUTION_SOURCE_LABELS = {
  'operator-dismiss': '人工驳回',
  'operator-merge': '人工合并',
  'partial-merge-exclusion': '部分合并自动排除'
} as const

export const COMPANY_MERGE_SUGGESTION_STATUSES = [
  'pending',
  'dismissed',
  'accepted'
] as const

export type CompanyMergeSuggestionStatus =
  (typeof COMPANY_MERGE_SUGGESTION_STATUSES)[number]

export const COMPANY_MERGE_RESOLUTION_SOURCES = [
  'operator-dismiss',
  'operator-merge',
  'partial-merge-exclusion'
] as const

export type CompanyMergeResolutionSource =
  (typeof COMPANY_MERGE_RESOLUTION_SOURCES)[number]

export type CompanyMergeEvidenceHit = {
  companyId: number
  source: 'vndb' | 'nextmoe'
  field: 'name' | 'original' | 'alias' | 'display_name'
  value: string
}

/**
 * One company of a queued cluster, as it looked when the list was read. Every
 * field is nullable-ish because detection can be older than the company table:
 * `name === null` means that company is already gone, and the merge dialog has
 * to refuse rather than submit a checked company that no longer exists.
 * Unchecked missing companies do not block the submit.
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
 * One row of the merge queue. `names` follows cluster order — the detected
 * target name first, then the sources — so `names[index + 1]` belongs to
 * `sourceCompanyIds[index]`. That full set is not the applied subset.
 * `foldedKey` is display-only; skip and reopen use the company-id member key.
 *
 * Json result columns are `null` when an older row did not store them. Do not
 * coerce that to `[]`.
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
  resolvedAt: string | null
  resolvedByUserId: number | null
  /** 查得到操作者用户名时带上；查不到则省略，前端退回 `#id`。 */
  resolvedByName?: string
  /** null = 旧记录未保存勾选结果。 */
  selectedCompanyIds: number[] | null
  /** null = 旧记录未保存实际留下的会社。 */
  appliedTargetCompanyId: number | null
  /** null = 旧记录未保存实际删除的会社。 */
  appliedSourceCompanyIds: number[] | null
  /** null = 旧记录未记录处理来源。 */
  resolutionSource: CompanyMergeResolutionSource | null
  /** 证据校验失败时为空数组，列表接口不因此 500。 */
  hits: CompanyMergeEvidenceHit[]
}

export interface CompanyMergeSuggestionListResponse {
  items: CompanyMergeSuggestion[]
}

export type CompanyMergeDetectPhase = 'local' | 'nextmoe' | 'vndb' | 'write'

/** One step of a running detect scan. `total` is 0 when that step is skipped. */
export interface CompanyMergeDetectProgress {
  phase: CompanyMergeDetectPhase
  current: number
  total: number
  detail?: string
}

export type CompanyMergeDetectStreamEvent =
  | ({ type: 'progress' } & CompanyMergeDetectProgress)
  | ({ type: 'done' } & CompanyMergeDetectResponse)
  | { type: 'error'; message: string }

export interface CompanyMergeDetectResponse {
  /** Keys written as new pending rows. */
  created: number
  /** Pending rows refreshed in place, including candidate-key member updates. */
  updated: number
  /**
   * Groups left alone because that member_key is already dismissed or
   * accepted, the target key belongs to another pending row, or the key
   * could not be built. Not a folded-key count.
   */
  skipped: number
  /** Wall time for this scan, including VNDB / NextMoe. */
  durationMs: number
  /** Short operator-facing notes, e.g. a member key already held by another pending row. */
  notes: string[]
}

export interface CompanyMergeDismissResponse {
  id: number
}

export interface CompanyMergeReopenResponse {
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

export const getCompanyMergeResolutionSourceLabel = (
  source: CompanyMergeResolutionSource | null
) =>
  source === null
    ? '旧记录未记录处理来源'
    : RESOLUTION_SOURCE_LABELS[source]

export const LEGACY_COMPANY_MERGE_SELECTION_LABEL = '旧记录未保存勾选结果'
