/**
 * Shared vocabulary for the operations case system.
 *
 * These values are persisted as varchar columns. Keep the codes stable: later
 * operations modules use the same case tables and internal service boundary.
 */
export const CASE_KINDS = [
  'resource_mismatch',
  // Interim kind until modules 04 and 05 ship link-level failure reports.
  'resource_link_failure',
  'resource_wrong_patch',
  'content_violation',
  'other',
  'patch_info',
  // Reserved contracts for later modules. They are intentionally not
  // accepted by the public create endpoint until those modules ship.
  'link_suspect',
  'link_disputed',
  'takedown_request',
  'mirror_version_check'
] as const
export type CaseKind = (typeof CASE_KINDS)[number]

export const OPEN_CASE_KINDS = [
  'resource_mismatch',
  'resource_link_failure',
  'resource_wrong_patch',
  'content_violation',
  'other',
  'patch_info'
] as const satisfies readonly CaseKind[]

/** Resource kinds that go to the resource publisher unless the resource is official. */
export const CASE_PUBLISHER_KINDS = [
  'resource_mismatch',
  'resource_link_failure'
] as const satisfies readonly CaseKind[]

export const CASE_TARGET_TYPES = [
  'resource',
  'patch',
  'comment',
  'rating',
  'shoutbox',
  'user',
  // Site-wide requests have no target row; target_id is always 0.
  'site',
  // Reserved for modules 04 and 07.
  'link',
  'help'
] as const
export type CaseTargetType = (typeof CASE_TARGET_TYPES)[number]

export const CASE_SITE_TARGET_ID = 0

export const CASE_OWNER_TYPES = ['publisher', 'staff'] as const
export type CaseOwnerType = (typeof CASE_OWNER_TYPES)[number]

export const CASE_STATUSES = [
  'open',
  'waiting_reporter',
  'waiting_owner',
  'resolved',
  'rejected',
  // Reserved for module 06. Module 03 never writes this value.
  'merged'
] as const
export type CaseStatus = (typeof CASE_STATUSES)[number]
export const CASE_UNRESOLVED_STATUSES = [
  'open',
  'waiting_reporter',
  'waiting_owner'
] as const satisfies readonly CaseStatus[]
export type UnresolvedCaseStatus = (typeof CASE_UNRESOLVED_STATUSES)[number]
export const CASE_CLOSED_STATUSES = [
  'resolved',
  'rejected'
] as const satisfies readonly CaseStatus[]
/**
 * 等待处理方: the handler's turn. The unified inbox and its sidebar count only
 * take staff cases in these states (D23); a case waiting on its reporter
 * stays in the case center.
 */
export const CASE_WAITING_HANDLER_STATUSES = [
  'open',
  'waiting_owner'
] as const satisfies readonly CaseStatus[]

export const CASE_SOURCES = [
  'user',
  'system',
  'publisher_convert',
  'help_escalation'
] as const
export type CaseSource = (typeof CASE_SOURCES)[number]

export const CASE_ACTOR_TYPES = [
  'system',
  'publisher',
  'staff',
  'reporter'
] as const
export type CaseActorType = (typeof CASE_ACTOR_TYPES)[number]

/** `report` is a later reporter's note saved on the case they subscribed to. */
export const CASE_MESSAGE_KINDS = ['reply', 'system', 'report'] as const
export type CaseMessageKind = (typeof CASE_MESSAGE_KINDS)[number]

export const CASE_MESSAGE_EVENTS = [
  'escalated',
  'resolved',
  'reopened',
  'hidden',
  'restored',
  'moved',
  'withdrawn',
  'confirmed',
  'close_proposed'
] as const
export type CaseMessageEvent = (typeof CASE_MESSAGE_EVENTS)[number]

/** Events whose message closes a round; the latest one carries `actor_type`. */
export const CASE_CLOSING_EVENTS = [
  'resolved',
  'hidden',
  'moved'
] as const satisfies readonly CaseMessageEvent[]

export const CASE_ESCALATION_TRIGGERS = ['timeout', 'review_request'] as const
export type CaseEscalationTrigger = (typeof CASE_ESCALATION_TRIGGERS)[number]

export const CASE_TABS = ['reported', 'owned', 'subscribed'] as const
export type CaseTab = (typeof CASE_TABS)[number]

export const CASE_ADMIN_ACTIONS = ['reply', 'resolve', 'reject'] as const
export type CaseAdminAction = (typeof CASE_ADMIN_ACTIONS)[number]

export const CASE_RESOURCE_ACTIONS = ['hide', 'restore', 'move'] as const
export type CaseResourceAction = (typeof CASE_RESOURCE_ACTIONS)[number]

export const CASE_CONTENT_ACTIONS = ['delete', 'takedown', 'restore'] as const
export type CaseContentAction = (typeof CASE_CONTENT_ACTIONS)[number]

export const CASE_RESOLUTIONS = [
  'repaired',
  'unreproducible',
  'out_of_scope',
  // Written only by the pre-D13 escalation path. Old rows stay readable and
  // restorable; new closures cannot use them.
  'escalated_hidden',
  'escalated_ignored',
  'reporter_unresponsive',
  'reporter_withdrawn',
  'relinked',
  'verified_available',
  'moved',
  'not_established',
  'violation_hidden',
  'handled',
  'declined',
  'other'
] as const
export type CaseResolution = (typeof CASE_RESOLUTIONS)[number]

/** Every resolution a row of the kind may carry, including system-written ones. */
export const CASE_RESOLUTIONS_BY_KIND: Record<
  CaseKind,
  readonly CaseResolution[]
> = {
  resource_mismatch: [
    'repaired',
    'unreproducible',
    'out_of_scope',
    'escalated_hidden',
    'escalated_ignored',
    'reporter_unresponsive',
    'reporter_withdrawn'
  ],
  resource_link_failure: [
    'relinked',
    'verified_available',
    'out_of_scope',
    'reporter_unresponsive',
    'reporter_withdrawn'
  ],
  resource_wrong_patch: [
    'moved',
    'not_established',
    'reporter_unresponsive',
    'reporter_withdrawn'
  ],
  content_violation: [
    'handled',
    'not_established',
    'violation_hidden',
    'reporter_unresponsive',
    'reporter_withdrawn'
  ],
  other: [
    'handled',
    'out_of_scope',
    'declined',
    'reporter_unresponsive',
    'reporter_withdrawn'
  ],
  patch_info: [
    'handled',
    'out_of_scope',
    'declined',
    'reporter_unresponsive',
    'reporter_withdrawn'
  ],
  link_suspect: [],
  link_disputed: [],
  takedown_request: [],
  mirror_version_check: []
}

/** What a processing party (publisher or staff) may choose for the kind. */
export const CASE_HANDLER_RESOLUTIONS_BY_KIND: Record<
  CaseKind,
  readonly CaseResolution[]
> = {
  resource_mismatch: ['repaired', 'unreproducible', 'out_of_scope'],
  resource_link_failure: ['relinked', 'verified_available', 'out_of_scope'],
  resource_wrong_patch: ['moved', 'not_established'],
  content_violation: ['handled', 'not_established', 'violation_hidden'],
  // 不采纳 answers a suggestion the site will not act on with a reason
  // instead of a guide link.
  other: ['handled', 'out_of_scope', 'declined'],
  patch_info: ['handled', 'out_of_scope', 'declined'],
  link_suspect: [],
  link_disputed: [],
  takedown_request: [],
  mirror_version_check: []
}

/** The three existing guides that out-of-scope closures must point to (D12). */
export const CASE_GUIDE_LINKS = {
  download: '/doc/notice/download',
  repairRar: '/doc/notice/repair-rar',
  contribute: '/doc/notice/contribute'
} as const
export const CASE_GUIDE_PATHS = Object.values(CASE_GUIDE_LINKS)

export const caseTextHasGuideLink = (text: string) =>
  CASE_GUIDE_PATHS.some((path) => text.includes(path))

/** Quick replies shared by publisher and staff interfaces (D12). */
export const CASE_QUICK_REPLIES = [
  { code: 'repaired', label: '已修复', content: '问题已修复，请重新查看。' },
  {
    code: 'need_more_info',
    label: '需要截图',
    content: '请补充相关截图（回复时可以直接附图），方便进一步核对。'
  },
  {
    code: 'download_guide',
    label: '下载问题',
    content: `下载慢、网盘限速等下载问题请先按下载相关问题解答排查：${CASE_GUIDE_LINKS.download}`
  },
  {
    code: 'archive_guide',
    label: '压缩包问题',
    content: `压缩包损坏、解压失败多数是下载不完整，请先核对文件大小，再按压缩包修复教程处理：${CASE_GUIDE_LINKS.repairRar}`
  },
  {
    code: 'contribute_guide',
    label: '投稿与求资源',
    content: `求资源、催更或收录请求请阅读内容贡献指南：${CASE_GUIDE_LINKS.contribute}`
  },
  {
    code: 'out_of_scope',
    label: '不在受理范围',
    content: `该问题不在当前受理范围内。下载问题见 ${CASE_GUIDE_LINKS.download}，压缩包问题见 ${CASE_GUIDE_LINKS.repairRar}，求资源与投稿见 ${CASE_GUIDE_LINKS.contribute}。`
  }
] as const

type CaseQuickReplyCode = (typeof CASE_QUICK_REPLIES)[number]['code']

/** Quick replies that make sense for the kind; resource guides stay off reports. */
const CASE_QUICK_REPLY_CODES_BY_KIND: Partial<
  Record<CaseKind, readonly CaseQuickReplyCode[]>
> = {
  resource_wrong_patch: ['need_more_info'],
  content_violation: ['need_more_info'],
  patch_info: ['repaired', 'need_more_info']
}

export const caseQuickRepliesFor = (kind: CaseKind) => {
  const codes = CASE_QUICK_REPLY_CODES_BY_KIND[kind]
  return codes
    ? CASE_QUICK_REPLIES.filter((reply) => codes.includes(reply.code))
    : CASE_QUICK_REPLIES
}

/**
 * Search scope of the case center (M03-9). `all` keeps matching the number,
 * kind, game, resource, reporter and dialogue together (review item 25).
 */
export const CASE_SEARCH_FIELDS = [
  'all',
  'id',
  'kind',
  'patch',
  'resource',
  'reporter',
  'content'
] as const
export type CaseSearchField = (typeof CASE_SEARCH_FIELDS)[number]
export const CASE_SEARCH_FIELD_LABELS: Record<CaseSearchField, string> = {
  all: '全部',
  id: '编号',
  kind: '类型',
  patch: '游戏',
  resource: '资源',
  reporter: '报告者',
  content: '对话内容'
}

/**
 * Columns the case center list sorts by. `time` is `status_changed_at`, the
 * waiting order the queue always had; `reporter` and `owner` sort by the
 * user's name.
 */
export const CASE_SORT_FIELDS = [
  'id',
  'status',
  'kind',
  'reporter',
  'owner',
  'time'
] as const
export type CaseSortField = (typeof CASE_SORT_FIELDS)[number]
export const CASE_SORT_ORDERS = ['asc', 'desc'] as const
export type CaseSortOrder = (typeof CASE_SORT_ORDERS)[number]

/**
 * Status filter of the case center list. It groups statuses the way their
 * badge reads rather than by code, so open and waiting_owner (both 等待处理方)
 * stay one option.
 */
export const CASE_STATUS_FILTERS = [
  'pending',
  'waiting_reporter',
  'resolved',
  'rejected'
] as const
export type CaseStatusFilter = (typeof CASE_STATUS_FILTERS)[number]
export const CASE_STATUS_FILTER_STATUSES: Record<
  CaseStatusFilter,
  readonly CaseStatus[]
> = {
  pending: CASE_WAITING_HANDLER_STATUSES,
  waiting_reporter: ['waiting_reporter'],
  resolved: ['resolved'],
  rejected: ['rejected']
}
/**
 * Ascending order of the status column: the filter's groups, then merged,
 * which module 03 never writes and the filter does not offer.
 */
export const CASE_STATUS_SORT_GROUPS: readonly (readonly CaseStatus[])[] = [
  ...CASE_STATUS_FILTERS.map((filter) => CASE_STATUS_FILTER_STATUSES[filter]),
  ['merged']
]

export const CASE_KIND_LABELS: Record<CaseKind, string> = {
  resource_mismatch: '资源与描述不符',
  resource_link_failure: '链接失效',
  resource_wrong_patch: '资源发错条目',
  content_violation: '违规举报',
  other: '其他',
  patch_info: '条目资料有误',
  link_suspect: '链接疑似失效',
  link_disputed: '链接争议',
  takedown_request: '申请下架',
  mirror_version_check: '镜像版本确认'
}

export const CASE_TARGET_TYPE_LABELS: Record<CaseTargetType, string> = {
  resource: '资源',
  patch: '条目',
  comment: '评论',
  rating: '评价',
  shoutbox: '小喇叭',
  user: '用户',
  site: '站务',
  link: '链接',
  help: '求助'
}

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  open: '等待处理方',
  waiting_reporter: '等待报告者',
  waiting_owner: '等待处理方',
  resolved: '已解决',
  rejected: '已驳回',
  merged: '已合并'
}

export const CASE_RESOLUTION_LABELS: Record<CaseResolution, string> = {
  repaired: '已修正',
  unreproducible: '无法复现',
  out_of_scope: '不在受理范围',
  escalated_hidden: '升级后隐藏',
  escalated_ignored: '升级后忽略',
  reporter_unresponsive: '开启者未回应',
  reporter_withdrawn: '开启者撤回',
  relinked: '已补链',
  verified_available: '核实可用',
  moved: '已移动',
  not_established: '不成立',
  violation_hidden: '违规隐藏',
  handled: '已处理',
  declined: '不采纳',
  other: '其他'
}

/** Public API allows only these combinations in module 03. */
export const CASE_KIND_TARGETS = {
  resource_mismatch: ['resource'],
  resource_link_failure: ['resource'],
  resource_wrong_patch: ['resource'],
  content_violation: ['comment', 'rating', 'shoutbox', 'user'],
  other: ['patch', 'site'],
  patch_info: ['patch']
} as const satisfies Record<
  (typeof OPEN_CASE_KINDS)[number],
  readonly CaseTargetType[]
>

/**
 * Combinations whose dedup key also carries the opener: every user keeps one
 * open case of their own instead of subscribing to someone else's (D14, D21).
 * Other feedback on a game is free text, so two users rarely report the same
 * thing and merging them would close one user's issue with another's.
 */
export const CASE_OPENER_SCOPED_TARGETS = [
  { kind: 'patch_info', targetType: 'patch' },
  { kind: 'other', targetType: 'patch' },
  { kind: 'other', targetType: 'site' }
] as const satisfies readonly { kind: CaseKind; targetType: CaseTargetType }[]

export const isCaseOpenerScoped = (kind: string, targetType: string) =>
  CASE_OPENER_SCOPED_TARGETS.some(
    (entry) => entry.kind === kind && entry.targetType === targetType
  )

/**
 * Frozen combinations are documented now so later modules can register their
 * own entry point without changing the persisted vocabulary.
 */
export const FROZEN_CASE_KIND_TARGETS = [
  {
    kind: 'content_violation',
    targetType: 'resource',
    ownerType: 'staff',
    timeout: 'none'
  },
  {
    kind: 'content_violation',
    targetType: 'help',
    ownerType: 'staff',
    timeout: 'module-07'
  },
  {
    kind: 'link_suspect',
    targetType: 'link',
    ownerType: 'module-04',
    timeout: 'module-04'
  },
  {
    kind: 'link_disputed',
    targetType: 'link',
    ownerType: 'module-04',
    timeout: 'module-04'
  },
  {
    kind: 'takedown_request',
    targetType: 'resource',
    ownerType: 'module-06',
    timeout: 'module-06'
  },
  {
    kind: 'mirror_version_check',
    targetType: 'resource',
    ownerType: 'module-06',
    timeout: 'module-06'
  }
] as const

/** Only module 03's publisher-owned resource kinds join the generic timeout task. */
export const CASE_PUBLISHER_TIMEOUT_KINDS = [
  'resource_mismatch',
  'resource_link_failure'
] as const
export const CASE_REPORTER_TIMEOUT_KINDS = [
  'resource_mismatch',
  'resource_link_failure'
] as const
export const CASE_PUBLISHER_ESCALATION_AFTER_MS = 7 * 24 * 60 * 60 * 1000
export const CASE_REPORTER_TIMEOUT_AFTER_MS = 14 * 24 * 60 * 60 * 1000
/**
 * A staff-owned case never times out (D5). Once it has waited on its reporter
 * as long as the publisher-side timeout, the site administrator may close it
 * as 开启者未回应 by hand (D24), so the conclusion means the same everywhere.
 */
export const CASE_STAFF_UNRESPONSIVE_AFTER_MS = CASE_REPORTER_TIMEOUT_AFTER_MS
export const CASE_REOPEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
/** Reminder lead before either timeout fires; one reminder per state revision. */
export const CASE_REMINDER_LEAD_MS = 48 * 60 * 60 * 1000
export const CASE_MAX_TIMEOUT_BATCH = 200
export const CASE_MAX_TIMEOUT_ROUNDS = 10
export const CASE_TIMEOUT_LOCK_KEY = 'cron:case-timeout:lock'
export const CASE_TIMEOUT_LOCK_TTL_SECONDS = 15 * 60

export const CASE_CONTENT_MAX_LENGTH = 5000
export const CASE_REPORT_MIN_LENGTH = 2
export const CASE_DESCRIPTION_MIN_LENGTH = 10
export const CASE_MESSAGE_MIN_LENGTH = 1
/** Notification bodies quote at most this many characters of a reply. */
export const CASE_NOTICE_SNIPPET_LENGTH = 60

/** Reporter images (D11): at most three per note, private to the dialogue. */
export const CASE_IMAGE_MAX_PER_MESSAGE = 3
export const CASE_IMAGE_ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif'
] as const

export const CASE_INBOX_KIND = 'case' as const
