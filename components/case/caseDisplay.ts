import {
  CASE_KIND_LABELS,
  CASE_PUBLISHER_ESCALATION_AFTER_MS,
  CASE_PUBLISHER_TIMEOUT_KINDS,
  CASE_REPORTER_TIMEOUT_AFTER_MS,
  CASE_REPORTER_TIMEOUT_KINDS,
  CASE_RESOLUTION_LABELS,
  CASE_STATUS_LABELS,
  CASE_TARGET_TYPE_LABELS,
  caseTextHasGuideLink
} from '~/constants/case'
import type {
  CaseKind,
  CaseMessage,
  CaseMessageEvent,
  CaseOwnerType,
  CaseResolution,
  CaseStatus,
  CaseSummary,
  CaseTab
} from '~/types/api/case'

export const caseKindLabel = (kind: CaseSummary['kind']): string =>
  CASE_KIND_LABELS[kind] ?? kind

/** User-facing handler name; the docs keep the term 站方 (D22). */
export const caseOwnerLabel = (ownerType: CaseOwnerType): string =>
  ownerType === 'publisher' ? '发布者' : '网站管理员'

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
 * Site page for the case target (D22): a resource opens its card on the game
 * page, other game-bound targets open the game page. Deleted targets and site
 * feedback have no page.
 */
export const caseTargetHref = (
  item: Pick<CaseSummary, 'targetType' | 'targetId' | 'target'>
): string | null => {
  if (item.target.deleted) return null
  if (item.targetType === 'user') return `/user/${item.targetId}`
  const resource = item.target.resource
  if (item.targetType === 'resource' && resource?.patch) {
    return `/${resource.patch.uniqueId}?tab=resources&resourceSection=${resource.section}&resourceId=${resource.id}`
  }
  const patch = resource?.patch ?? item.target.patch
  return patch ? `/${patch.uniqueId}` : null
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
 *
 * A `report` message is a later reporter's note saved on the case (D15), so it
 * is filed under「其他报告者」whoever wrote it.
 */
export const caseMessageSide = (
  message: CaseMessage,
  reporterId: number | null | undefined,
  identifiesReporter = false
): 'system' | 'reporter' | 'other-reporter' | 'owner' | 'unknown' => {
  if (message.kind === 'system') return 'system'
  if (message.kind === 'report') return 'other-reporter'
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
        ? `发布者处理中，约 ${formatCaseDuration(remaining)}后提交给网站管理员处理`
        : '已到时限，即将提交给网站管理员处理'
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
    : `网站管理员处理中，已等待 ${waited}`
}

/**
 * The server's closing-note rule (D12, D16, D21), mirrored so a form can
 * stop before submitting. Called with an empty note it returns what the note
 * must contain; null means the note is optional or already fine.
 */
export const caseClosingNoteError = (
  item: Pick<CaseSummary, 'kind' | 'targetType'>,
  resolution: CaseResolution | '',
  content: string
): string | null => {
  if (resolution === 'unreproducible') {
    return content.trim() ? null : '以「无法复现」结案时请写明核对了什么'
  }
  if (resolution !== 'out_of_scope') return null
  if (item.kind === 'other' && item.targetType === 'site') {
    return content.trim() ? null : '以「不在受理范围」结案时请写明理由'
  }
  return caseTextHasGuideLink(content)
    ? null
    : '以「不在受理范围」结案时请附上下载、压缩包或投稿指南中的一篇链接'
}

const ROUND_BOUNDARY_EVENTS: ReadonlySet<CaseMessageEvent> = new Set([
  'escalated',
  'reopened',
  'resolved',
  'hidden',
  'moved'
])

/**
 * The original publisher's latest closure proposal in the current round (D20):
 * the `close_proposed` event and the note written right after it. Only the
 * admin view carries payloads, so other views get null.
 */
export const caseLatestProposal = (
  messages: readonly CaseMessage[]
): { resolution: CaseResolution; note: string; created: string } | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.event && ROUND_BOUNDARY_EVENTS.has(message.event)) return null
    if (message.event !== 'close_proposed') continue
    const resolution = message.payload?.resolution
    if (!resolution) return null
    const note = messages[index + 1]
    return {
      resolution,
      note: note && note.kind === 'reply' ? note.body : '',
      created: message.created
    }
  }
  return null
}

/** Whether the latest handoff came from the opener's review request (D16). */
export const caseReviewRequested = (messages: readonly CaseMessage[]) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.event === 'escalated') {
      return message.payload?.escalation_trigger === 'review_request'
    }
  }
  return false
}
