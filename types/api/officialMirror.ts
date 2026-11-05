/** Admin and resolve contracts for selective backup and stock merges. */

export const OFFICIAL_MIRROR_SECTIONS = ['galgame', 'patch'] as const
export type OfficialMirrorSection = (typeof OFFICIAL_MIRROR_SECTIONS)[number]

export const BACKUP_TABS = ['unbacked', 'rebackup', 'ignored'] as const
export type BackupTab = (typeof BACKUP_TABS)[number]

export const BACKUP_SORTS = ['download_desc', 'download_asc'] as const
export type BackupSort = (typeof BACKUP_SORTS)[number]

export const MERGE_TABS = ['pending', 'dismissed', 'merged'] as const
export type MergeTab = (typeof MERGE_TABS)[number]

export const PAIR_CLASSES = ['high', 'manual'] as const
export type PairClass = (typeof PAIR_CLASSES)[number]

/**
 * List order. `handled_desc` orders the dismissed and merged tabs by the
 * latest record; `waiting_longest` orders pending rows by the earliest
 * pair wait start and history rows by the earliest record.
 */
export const MERGE_SORTS = [
  'download_desc',
  'waiting_longest',
  'game_name',
  'handled_desc'
] as const
export type MergeSort = (typeof MERGE_SORTS)[number]

/** Facts compared between a user card and one staff card. Ordering only. */
export const MERGE_SIGNALS = [
  'type',
  'language',
  'platform',
  'size',
  'name',
  'later',
  'unique'
] as const
export type MergeSignal = (typeof MERGE_SIGNALS)[number]

/**
 * Recommendation outcome for one user card.
 * - `recommended`: one mergeable option qualifies.
 * - `close`: the leader does not lead the runner-up by two hits.
 * - `insufficient`: the leader matches fewer than two of type, language, platform.
 * - `none`: no option can be merged.
 */
export const MERGE_RECOMMEND_STATES = [
  'recommended',
  'close',
  'insufficient',
  'none'
] as const
export type MergeRecommendState = (typeof MERGE_RECOMMEND_STATES)[number]

/** Leader must beat the runner-up by this many hits when there are several options. */
export const MERGE_RECOMMEND_LEAD = 2
/** Of type, language and platform, the leader must match at least this many. */
export const MERGE_RECOMMEND_MIN_ATTRIBUTES = 2
/** Relative size tolerance for the size signal. */
export const MERGE_SIZE_TOLERANCE = 0.03
export const MERGE_DISMISS_CARD_MAX = 50

export const RESOURCE_NOTE_MAX = 10007
export const IGNORE_REASON_MAX = 500
export const MERGE_BATCH_MAX = 50
export const OFFICIAL_MIRROR_PAGE_LIMIT = 100

export const OFFICIAL_MIRROR_BLOCK_CODES = [
  'staff_not_public',
  'game_not_public',
  'staff_link_not_touchgal',
  'staff_case_open',
  'note_too_long',
  'resource_missing',
  'user_handed_over',
  'user_not_public',
  'pair_dismissed',
  'already_merged_other',
  'survivor_chain',
  'not_candidate',
  'section_mismatch',
  'basis_stale',
  'not_high_confidence',
  'content_unconfirmed'
] as const
export type OfficialMirrorBlockCode =
  (typeof OFFICIAL_MIRROR_BLOCK_CODES)[number]

export type OfficialMirrorBlock = {
  code: OfficialMirrorBlockCode
  message: string
}

export type OfficialMirrorPublisher = {
  id: number
  name: string
}

export type OfficialMirrorLinkView = {
  id: number
  storage: string
  content: string
  size: string
  version: number
  sortOrder: number
  changedAt: string | null
  backedUpAt: string | null
}

export type BackupQueueAge = {
  resourceId: number
  since: string
  ageMs: number
}

export type BackupListItem = {
  resourceId: number
  name: string
  section: OfficialMirrorSection
  patchId: number
  patchUniqueId: string
  patchName: string
  publisher: OfficialMirrorPublisher
  download: number
  externalLinkCount: number
  latestExternalChangeAt: string | null
  backupAt: string | null
  tab: BackupTab
  waitSince: string | null
}

export type BackupListResponse = {
  items: BackupListItem[]
  total: number
  page: number
  limit: number
  counts: Record<BackupTab, number>
  oldest: Record<'unbacked' | 'rebackup', BackupQueueAge | null>
}

export type BackupDetail = BackupListItem & {
  note: string
  links: OfficialMirrorLinkView[]
  ignore: { at: string; byUserId: number | null; reason: string | null } | null
  rebackupDismissedAt: string | null
  basis: string
}

export type BackupMutationResult = {
  changed: boolean
  resourceId: number
  tab: BackupTab | null
  cacheRefreshed: boolean
}

export type MergeCardSummary = {
  id: number
  name: string
  section: OfficialMirrorSection
  patchId: number
  patchUniqueId: string
  patchName: string
  publisher: OfficialMirrorPublisher
  download: number
  created: string
  status: number
}

export type MergeCandidateSummary = {
  staffResourceId: number
  staffName: string
  staffStatus: number
  pairClass: PairClass
  blocks: OfficialMirrorBlock[]
}

export type MergeRecommendation = {
  staffResourceId: number
  staffName: string
}

export type MergeListItem = {
  userResource: MergeCardSummary
  pairClass: PairClass
  candidateCount: number
  candidates: MergeCandidateSummary[]
  blocks: OfficialMirrorBlock[]
  /** Staff cards (role >= 3) in the same game, both sections. */
  officialCount: number
  /** The user card already carries a `touchgal` link. */
  hasStaffBackup: boolean
  /** Pending tab only; null elsewhere. */
  recommendState: MergeRecommendState | null
  recommendation: MergeRecommendation | null
  /** Latest record on the dismissed and merged tabs; null on pending. */
  handledAt: string | null
  handledBy: OfficialMirrorPublisher | null
}

export type MergeListResponse = {
  items: MergeListItem[]
  total: number
  page: number
  limit: number
  counts: Record<MergeTab, number>
  oldestPending: BackupQueueAge | null
}

export type MergeFieldComparison = {
  field: string
  user: string
  staff: string
}

/**
 * One compared fact. Values are raw: attribute codes for type, language and
 * platform; size strings for size; the card name for name; ISO created time
 * for later; the live candidate count of each side for unique.
 */
export type MergeSignalCheck = {
  signal: MergeSignal
  hit: boolean
  user: string[]
  staff: string[]
}

export type MergeOption = {
  staff: MergeCardSummary & { hasStaffBackup: boolean }
  sameSection: boolean
  signals: MergeSignalCheck[]
  hits: number
  recommended: boolean
  highConfidence: boolean
  /** Same section, no block, no record, user card eligible. */
  mergeable: boolean
  /** A pending pair that can be dismissed now (no record, both cards candidates). */
  dismissable: boolean
  blocks: OfficialMirrorBlock[]
  /** Dismissed pairs can be reopened. */
  record: 'dismissed' | null
}

export type MergeHistoryEntry = {
  staffResourceId: number
  /** Fallback text when the staff card is gone. */
  staffName: string
  status: 'dismissed' | 'merged'
  handledAt: string
  handledBy: OfficialMirrorPublisher | null
  movedLinkIds: number[]
}

/**
 * Every staff card of the user card's game, ordered: recommended, other
 * mergeable by hits, then the rest. Basis still comes from preview.
 */
export type MergeOptionsResponse = {
  user: MergeCardSummary & {
    hasStaffBackup: boolean
    /** Meets the user-side candidate rule and has not survived a merge. */
    eligible: boolean
  }
  recommendState: MergeRecommendState
  options: MergeOption[]
  /** Dismissed and merged records of this user card. */
  history: MergeHistoryEntry[]
}

export type MergeDismissCardResult = {
  changed: boolean
  dismissed: number[]
  unchanged: number[]
  skipped: { staffResourceId: number; reason: string }[]
}

export type MergePreview = {
  classification: PairClass
  canMerge: boolean
  blocks: OfficialMirrorBlock[]
  basis: string
  user: MergeCardSummary
  staff: MergeCardSummary
  survivorPreview: {
    name: string
    type: string[]
    language: string[]
    platform: string[]
    note: string
    noteAppended: boolean
    links: OfficialMirrorLinkView[]
  }
  fieldComparison: MergeFieldComparison[]
  /** Likes on the staff card; they are dropped by the merge. */
  staffLikeCount: number
  exitedPairs: {
    staffResourceId: number
    staffName: string
    retained: true
  }[]
}

export type MergeResult = {
  alreadyMerged: boolean
  userResourceId: number
  staffResourceId: number
  resourceId: number
  patchId: number
  patchUniqueId: string
  section: OfficialMirrorSection
  movedLinkIds: number[]
  noteAppended: boolean
  cacheRefreshed: boolean
}

export type MergeBatchPairRef = {
  userResourceId: number
  staffResourceId: number
}

/** One started pair. Business rejection is skipped; it does not stop later pairs. */
export type MergeBatchOutcome =
  | (MergeBatchPairRef & { status: 'merged'; result: MergeResult })
  | (MergeBatchPairRef & { status: 'skipped'; reason: string })
  | (MergeBatchPairRef & { status: 'failed'; reason: string })

/**
 * `outcomes` contains every pair whose transaction started.
 * `remaining` lists pairs not started after the batch process itself stopped.
 * A skipped or failed pair does not by itself fill `remaining`.
 * Each request pair still carries its own `contentConfirmed`; the batch is not a shared confirmation.
 */
export type MergeBatchResult = {
  outcomes: MergeBatchOutcome[]
  remaining: MergeBatchPairRef[]
}

/** Current location of a merged-away staff card. Misses are JSON null. */
export type OfficialMirrorResolveHit = {
  resourceId: number
  patchId: number
  patchUniqueId: string
  section: OfficialMirrorSection
}

export type OfficialMirrorCacheRefresh = {
  uniqueIds: string[]
  authorIds: number[]
  cacheRefreshed: boolean
}
