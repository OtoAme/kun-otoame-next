import {
  CASE_KIND_LABELS,
  CASE_PUBLISHER_ESCALATION_AFTER_MS,
  CASE_PUBLISHER_TIMEOUT_KINDS,
  CASE_REPORTER_TIMEOUT_AFTER_MS,
  CASE_REPORTER_TIMEOUT_KINDS,
  CASE_RESOLUTION_LABELS,
  CASE_STATUS_LABELS,
  CASE_TARGET_TYPE_LABELS
} from '~/constants/case'
import type {
  CaseKind,
  CaseMessage,
  CaseMessageEvent,
  CaseOwnerType,
  CaseStatus,
  CaseSummary,
  CaseTab
} from '~/types/api/case'

export const caseKindLabel = (kind: CaseSummary['kind']): string =>
  CASE_KIND_LABELS[kind] ?? kind

export const caseStatusLabel = (status: CaseStatus): string =>
  CASE_STATUS_LABELS[status] ?? status

export const caseResolutionLabel = (
  resolution: CaseSummary['resolution']
): string | null =>
  resolution ? (CASE_RESOLUTION_LABELS[resolution] ?? resolution) : null

/** Short target description for list rows and detail headers. Never invents identity. */
export const caseTargetText = (
  item: Pick<CaseSummary, 'targetType' | 'targetId' | 'target'>
): string => {
  const typeLabel = CASE_TARGET_TYPE_LABELS[item.targetType] ?? item.targetType
  if (item.target.deleted) {
    return `${typeLabel}已删除`
  }
  if (item.targetType === 'patch') {
    return item.target.patch?.name || `条目 #${item.targetId}`
  }
  if (item.targetType === 'resource') {
    const resourceName = item.target.resource?.name || `资源 #${item.targetId}`
    const patchName =
      item.target.resource?.patch?.name ?? item.target.patch?.name
    return patchName ? `${resourceName}（${patchName}）` : resourceName
  }
  return item.target.label || `${typeLabel} #${item.targetId}`
}

/**
 * Author label for a conversation message. The server trims identity per
 * viewer; an anonymized reporter arrives with `author: null` and must be
 * rendered as「报告者」— never look the identity up elsewhere.
 *
 * `identifiesReporter` says whether this viewer is allowed to identify the
 * reporter (`'reporter' in detail`). In such a view the server never blanks an
 * author, so `author: null` means the account was hard-deleted (`author_id` is
 * `onDelete: SetNull`) and the message cannot be attributed to anybody. It
 * defaults to false so existing call sites keep the anonymized reading.
 */
export const caseMessageAuthorLabel = (
  message: CaseMessage,
  identifiesReporter = false
): string => {
  if (message.kind === 'system') {
    return '系统'
  }
  if (!message.author) {
    return identifiesReporter ? '已注销用户' : '报告者'
  }
  return message.author.name || '报告者'
}

/**
 * Which side of the conversation a message belongs to, derived only from what
 * the server exposes. A system entry is flagged by `kind`; a named author is
 * the reporter when the id matches and otherwise the processing party, since
 * the API lets nobody else reply. The caller must not try to tell publisher
 * from staff — message authors are serialized without a role.
 *
 * `author: null` has two very different causes, and `identifiesReporter`
 * (`'reporter' in detail`) is what separates them:
 *
 * - Anonymized view: the server blanks the reporter on purpose, so the message
 *   is the reporter's. This is the default, keeping existing call sites intact.
 * - Identifying view (admin / reporter): the server blanks nobody, so a null
 *   author is a hard-deleted account. Both `author_id` and `reporter_id` are
 *   `onDelete: SetNull`, so a deleted reporter and a deleted processing party
 *   look identical here — the side is genuinely unknowable and must not be
 *   guessed, or a moderator's words end up filed under the reporter.
 */
export const caseMessageSide = (
  message: CaseMessage,
  reporterId: number | null | undefined,
  identifiesReporter = false
): 'system' | 'reporter' | 'owner' | 'unknown' => {
  if (message.kind === 'system') return 'system'
  if (!message.author) return identifiesReporter ? 'unknown' : 'reporter'
  return reporterId !== null &&
    reporterId !== undefined &&
    message.author.id === reporterId
    ? 'reporter'
    : 'owner'
}

/**
 * First-person status for the viewer's tab: in「我提交的」waiting_reporter
 * means the viewer must supplement; in「待我处理」open/waiting_owner means the
 * viewer must act. Other tabs keep the neutral shared labels.
 */
export const caseViewerStatusText = (
  item: Pick<CaseSummary, 'status'>,
  tab: CaseTab
): string => {
  if (tab === 'reported' && item.status === 'waiting_reporter') {
    return '等待我补充'
  }
  if (
    tab === 'owned' &&
    (item.status === 'open' || item.status === 'waiting_owner')
  ) {
    return '等待我处理'
  }
  return caseStatusLabel(item.status)
}

const SYSTEM_EVENT_FALLBACK: Record<CaseMessageEvent, string> = {
  escalated: '已提交给网站管理员处理',
  resolved: '已结案',
  reopened: '已重新打开',
  hidden: '资源已被隐藏',
  restored: '资源已恢复',
  moved: '资源已移动至正确条目',
  withdrawn: '开启者已撤回自己的报告',
  confirmed: '报告者已确认处理结果',
  close_proposed: '原发布者提请结案'
}

/**
 * Text for a system timeline entry. The server-composed body wins; payload is
 * only consulted for the resolution label — raw payload identity fields
 * (from_owner_id 等) are never rendered.
 */
export const caseSystemEventText = (message: CaseMessage): string => {
  const body = message.body?.trim()
  if (body) {
    return body
  }
  const fallback = message.event
    ? SYSTEM_EVENT_FALLBACK[message.event]
    : '系统消息'
  if (message.event === 'resolved' && message.payload?.resolution) {
    const label = CASE_RESOLUTION_LABELS[message.payload.resolution]
    return label ? `${fallback}：${label}` : fallback
  }
  return fallback
}

/** Compact duration for status hints and queue rows: 「3 天」「5 小时」「12 分钟」. */
export const formatCaseDuration = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return '不足 1 分钟'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时`
  return `${Math.floor(hours / 24)} 天`
}

interface CaseStatusHintSource {
  kind: CaseKind
  ownerType: CaseOwnerType
  status: CaseStatus
  statusChangedAt: string
}

/**
 * Status/SLA hint derived only from summary fields and the documented module-03
 * timeouts (publisher 7-day escalation, publisher-owned 14-day reporter
 * timeout; staff-owned cases never auto-close). Returns null for closed cases
 * and for combinations with no time rule, where the status label says enough.
 */
export const caseStatusHint = (
  item: CaseStatusHintSource,
  now: number = Date.now()
): string | null => {
  if (item.status === 'resolved' || item.status === 'rejected') return null
  const enteredAt = Date.parse(item.statusChangedAt)
  if (Number.isNaN(enteredAt)) return null
  if (item.ownerType === 'publisher') {
    if (
      (item.status === 'open' || item.status === 'waiting_owner') &&
      (CASE_PUBLISHER_TIMEOUT_KINDS as readonly string[]).includes(item.kind)
    ) {
      const remaining = enteredAt + CASE_PUBLISHER_ESCALATION_AFTER_MS - now
      return remaining > 0
        ? `发布者处理中，约 ${formatCaseDuration(remaining)}后升级站方`
        : '已达升级时限，等待系统升级'
    }
    if (
      item.status === 'waiting_reporter' &&
      (CASE_REPORTER_TIMEOUT_KINDS as readonly string[]).includes(item.kind)
    ) {
      const remaining = enteredAt + CASE_REPORTER_TIMEOUT_AFTER_MS - now
      return remaining > 0
        ? `等待报告者回应，约 ${formatCaseDuration(remaining)}后自动结案`
        : '已达自动结案时限，等待系统结案'
    }
    return null
  }
  const waited = formatCaseDuration(now - enteredAt)
  return item.status === 'waiting_reporter'
    ? `等待报告者补充，已等待 ${waited}`
    : `站方处理中，已等待 ${waited}`
}
