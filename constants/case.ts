/**
 * Shared vocabulary for the operations case system.
 *
 * These values are persisted as varchar columns. Keep the codes stable: later
 * operations modules use the same case tables and internal service boundary.
 */
export const CASE_KINDS = [
  'resource_mismatch',
  'resource_wrong_patch',
  'content_violation',
  'other',
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
  'resource_wrong_patch',
  'content_violation',
  'other'
] as const satisfies readonly CaseKind[]

export const CASE_TARGET_TYPES = [
  'resource',
  'patch',
  'comment',
  'rating',
  'shoutbox',
  'user',
  // Reserved for modules 04 and 07.
  'link',
  'help'
] as const
export type CaseTargetType = (typeof CASE_TARGET_TYPES)[number]

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

export const CASE_SOURCES = [
  'user',
  'system',
  'publisher_convert',
  'help_escalation'
] as const
export type CaseSource = (typeof CASE_SOURCES)[number]

export const CASE_ACTOR_TYPES = ['system', 'publisher', 'staff'] as const
export type CaseActorType = (typeof CASE_ACTOR_TYPES)[number]

export const CASE_MESSAGE_KINDS = ['reply', 'system'] as const
export type CaseMessageKind = (typeof CASE_MESSAGE_KINDS)[number]

export const CASE_MESSAGE_EVENTS = [
  'escalated',
  'resolved',
  'reopened',
  'hidden',
  'restored',
  'moved'
] as const
export type CaseMessageEvent = (typeof CASE_MESSAGE_EVENTS)[number]

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
  'escalated_hidden',
  'escalated_ignored',
  'reporter_unresponsive',
  'moved',
  'not_established',
  'violation_hidden',
  'handled',
  'other'
] as const
export type CaseResolution = (typeof CASE_RESOLUTIONS)[number]

export const PUBLIC_CASE_RESOLUTIONS = [
  'repaired',
  'unreproducible',
  'out_of_scope',
  'escalated_hidden',
  'escalated_ignored',
  'reporter_unresponsive'
] as const satisfies readonly CaseResolution[]

export const CASE_RESOLUTIONS_BY_KIND: Record<
  CaseKind,
  readonly CaseResolution[]
> = {
  resource_mismatch: PUBLIC_CASE_RESOLUTIONS,
  resource_wrong_patch: ['moved', 'not_established'],
  content_violation: ['handled', 'not_established', 'violation_hidden'],
  other: ['handled', 'out_of_scope'],
  link_suspect: [],
  link_disputed: [],
  takedown_request: [],
  mirror_version_check: []
}

/** Four short replies shared by publisher and staff interfaces. */
export const CASE_QUICK_REPLIES = [
  { code: 'repaired', label: '已修复', content: '问题已修复，请重新查看。' },
  {
    code: 'need_more_info',
    label: '需要截图',
    content: '请补充相关截图，方便进一步核对。'
  },
  {
    code: 'read_guide',
    label: '请参考指南',
    content: '请先参考相关使用指南。'
  },
  {
    code: 'out_of_scope',
    label: '不在受理范围',
    content: '该问题不在当前受理范围内。'
  }
] as const

export const CASE_KIND_LABELS: Record<CaseKind, string> = {
  resource_mismatch: '资源与描述不符',
  resource_wrong_patch: '资源发错条目',
  content_violation: '违规举报',
  other: '其他',
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
  moved: '已移动',
  not_established: '不成立',
  violation_hidden: '违规隐藏',
  handled: '已处理',
  other: '其他'
}

/** Public API allows only these combinations in module 03. */
export const CASE_KIND_TARGETS = {
  resource_mismatch: ['resource'],
  resource_wrong_patch: ['resource'],
  content_violation: ['comment', 'rating', 'shoutbox', 'user'],
  other: ['patch']
} as const satisfies Record<
  (typeof OPEN_CASE_KINDS)[number],
  readonly CaseTargetType[]
>

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

/** Only module 03's resource mismatch participates in the generic timeout task. */
export const CASE_PUBLISHER_TIMEOUT_KINDS = ['resource_mismatch'] as const
export const CASE_REPORTER_TIMEOUT_KINDS = ['resource_mismatch'] as const
export const CASE_PUBLISHER_ESCALATION_AFTER_MS = 7 * 24 * 60 * 60 * 1000
export const CASE_REPORTER_TIMEOUT_AFTER_MS = 14 * 24 * 60 * 60 * 1000
export const CASE_REOPEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
export const CASE_MAX_TIMEOUT_BATCH = 200
export const CASE_MAX_TIMEOUT_ROUNDS = 10
export const CASE_TIMEOUT_LOCK_KEY = 'cron:case-timeout:lock'
export const CASE_TIMEOUT_LOCK_TTL_SECONDS = 15 * 60

export const CASE_CONTENT_MAX_LENGTH = 5000
export const CASE_REPORT_MIN_LENGTH = 2
export const CASE_DESCRIPTION_MIN_LENGTH = 10
export const CASE_MESSAGE_MIN_LENGTH = 1

export const CASE_INBOX_KIND = 'case' as const
