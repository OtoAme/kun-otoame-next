import {
  CASE_KIND_LABELS,
  CASE_RESOLUTION_LABELS,
  CASE_STATUS_LABELS,
  CASE_TARGET_TYPE_LABELS
} from '~/constants/case'
import type {
  CaseMessage,
  CaseMessageEvent,
  CaseStatus,
  CaseSummary
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
 */
export const caseMessageAuthorLabel = (message: CaseMessage): string => {
  if (message.kind === 'system') {
    return '系统'
  }
  return message.author?.name || '报告者'
}

const SYSTEM_EVENT_FALLBACK: Record<CaseMessageEvent, string> = {
  escalated: '已升级为站方处理',
  resolved: '已结案',
  reopened: '已重新打开',
  hidden: '资源已被隐藏',
  restored: '资源已恢复',
  moved: '资源已移动至正确条目'
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
