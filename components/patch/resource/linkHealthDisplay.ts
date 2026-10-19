import { LINK_HEALTH_ERRORS } from '~/constants/linkHealth'
import { LINK_MAINTENANCE_ERRORS } from '~/constants/linkMaintenance'
import { formatTimeDifference } from '~/utils/time'
import type {
  LinkMaintenanceReportReceipt,
  LinkMaintenanceRestriction
} from '~/types/api/linkMaintenance'

const snapshotIds = new WeakMap<object, number>()
let snapshotSeq = 0

/**
 * Frontend-only read snapshot identity: a NEW resource object (server read,
 * parent refresh) means a NEW snapshot even when id and version are unchanged
 * (e.g. code/password-only edits keep the version). Same object reference
 * renders keep the identity, so local state renders never refetch.
 */
export const readSnapshotId = (value: object | null | undefined): number => {
  if (!value || typeof value !== 'object') {
    return 0
  }
  let id = snapshotIds.get(value)
  if (id === undefined) {
    id = ++snapshotSeq
    snapshotIds.set(value, id)
  }
  return id
}
import type {
  LinkCheckSummary,
  LinkHealth,
  LinkHealthBasis,
  LinkHealthSummary,
  LinkHealthView,
  LinkReportReason,
  LinkTarget
} from '~/types/api/linkHealth'
import type {
  PatchResourceHealthLink,
  PatchResourceLink
} from '~/types/api/patch'

/**
 * UI-only helpers for module 04/05/10 link health. Components read health data
 * through `readLinkHealth`: it returns null for payloads without health fields
 * so the plain card stays intact, and passes through the stable reader's
 * projection verbatim; it never recomputes any server fact.
 */
export const readLinkHealth = (
  link: PatchResourceLink
): PatchResourceHealthLink | null => {
  const candidate = link as PatchResourceHealthLink
  if (
    typeof candidate.health !== 'string' ||
    typeof candidate.version !== 'number' ||
    typeof candidate.capabilities !== 'object' ||
    candidate.capabilities === null
  ) {
    return null
  }
  return candidate
}

export const LINK_HEALTH_LABELS: Record<LinkHealth, string> = {
  ok: '正常',
  suspect: '疑似失效',
  disputed: '有争议',
  broken: '已失效'
}

export const LINK_REPORT_REASON_LABELS: Record<LinkReportReason, string> = {
  deleted: '网盘页面显示文件已删除、已过期或违规',
  access_condition: '链接要求付费，或取得方式与发布说明不符',
  unreachable: '打不开、超时'
}

export const LINK_REPORT_REASON_HINTS: Record<LinkReportReason, string> = {
  deleted: '以网盘页面的实际提示为准',
  access_condition: '网盘本身要求登录属于正常取得方式，不算失效',
  unreachable: '先确认已尝试更换网络或加速器，再提交报告'
}

/**
 * Processing state: never merges machine and user observations into one
 * red/green label. Dispute copy follows the frozen vocabulary.
 */
export const linkProcessingStateText = (summary: LinkHealthSummary): string => {
  if (summary.health === 'suspect') {
    return summary.ownerType === 'staff'
      ? '疑似失效，等待站方处理'
      : '疑似失效，等待归属方处理'
  }
  if (summary.health === 'disputed') {
    if (summary.disputeSource === 'machine_user_conflict') {
      return '检测端可访问，但有用户反馈异常 · 等待复核'
    }
    return summary.ownerType === 'staff'
      ? '站方称可用，多名用户称失效 · 等待复核'
      : '发布者称可用，多名用户称失效 · 等待复核'
  }
  if (summary.health === 'broken') {
    return '已失效'
  }
  return ''
}

/** Machine observation with explicit unchecked / stale / failed states. */
export const linkCheckSummaryText = (
  check: LinkCheckSummary | null
): string => {
  if (!check) {
    return '机器检测：未检测'
  }
  if (check.failed || !check.checkedAt) {
    return '机器检测：无法判断 / 检测失败'
  }
  const time = formatTimeDifference(check.checkedAt)
  const verdictText =
    check.verdict === 'available'
      ? '检测端可访问'
      : check.verdict === 'broken'
        ? '检测确认失效'
        : '无法判断'
  const suffix = check.stale ? '，结果已过期' : ''
  return `机器检测：${verdictText} · ${time}${suffix}`
}

export const linkReportCountText = (recentReportCount: number): string =>
  recentReportCount > 0
    ? `近期 ${recentReportCount} 人报告问题`
    : '近期无人报告问题'

/** Resource-level fold line, e.g.「2 条链接已失效 · 最近补链 3 天前」. */
export const brokenLinksFoldText = (
  brokenCount: number,
  lastRelinkAt: string | null
): string | null => {
  if (brokenCount <= 0) {
    return null
  }
  return lastRelinkAt
    ? `${brokenCount} 条链接已失效 · 最近补链 ${formatTimeDifference(lastRelinkAt)}`
    : `${brokenCount} 条链接已失效`
}

/** Latest relink instant across a resource's links. */
export const latestRelinkAt = (
  links: readonly PatchResourceLink[]
): string | null => {
  let latest: string | null = null
  for (const link of links) {
    const relinkAt = readLinkHealth(link)?.lastRelinkAt
    if (relinkAt && (!latest || new Date(relinkAt) > new Date(latest))) {
      latest = relinkAt
    }
  }
  return latest
}

export const countBrokenLinks = (links: readonly PatchResourceLink[]): number =>
  links.reduce(
    (count, link) =>
      count + (readLinkHealth(link)?.health === 'broken' ? 1 : 0),
    0
  )

/** Version-bearing target for report submissions; null disables reporting. */
export const buildLinkTarget = (
  patchId: number,
  resourceId: number,
  link: PatchResourceLink
): LinkTarget | null => {
  const health = readLinkHealth(link)
  if (!health) {
    return null
  }
  return { patchId, resourceId, linkId: link.id, linkVersion: health.version }
}

/** Full expectation basis for owner/resolve/check actions. */
export const buildLinkBasis = (
  patchId: number,
  resourceId: number,
  link: PatchResourceLink
): LinkHealthBasis | null => {
  const health = readLinkHealth(link)
  if (!health) {
    return null
  }
  return {
    patchId,
    resourceId,
    linkId: link.id,
    linkVersion: health.version,
    evidenceRound: health.evidenceRound,
    health: health.health,
    healthChangedAt: health.healthChangedAt
  }
}

const LINK_CONFLICT_MESSAGES: ReadonlySet<string> = new Set([
  LINK_HEALTH_ERRORS.version_conflict.message,
  LINK_HEALTH_ERRORS.state_conflict.message,
  LINK_HEALTH_ERRORS.resource_conflict.message,
  LINK_HEALTH_ERRORS.verification_cooldown.message
])

/**
 * Named 409 vocabulary: the UI surfaces these and keeps local state; it never
 * silently refreshes and resubmits.
 */
export const isLinkConflictError = (message: string): boolean =>
  LINK_CONFLICT_MESSAGES.has(message.trim())

export type LinkReportOutcome = 'recorded' | 'renewed' | 'duplicate'

/**
 * Health ordering for display/basis merges: a projection supersedes another
 * only when its version is newer, or the version matches and its evidence
 * round is at least as new. Ties resolve to the later-applied projection.
 */
export const isHealthAtLeast = (
  candidate: Pick<LinkHealthSummary, 'version' | 'evidenceRound'>,
  reference: Pick<LinkHealthSummary, 'version' | 'evidenceRound'>
): boolean =>
  candidate.version > reference.version ||
  (candidate.version === reference.version &&
    candidate.evidenceRound >= reference.evidenceRound)

/**
 * Single effective health projection: server snapshot first, then apply a
 * mutation response only when it is not older than the server snapshot, so an
 * older override can never mask a newer server read (e.g. broken → ok). Tie
 * cases (same version+round) are settled by snapshot provenance at the call
 * sites, not by this ordering alone.
 */
export const maintenanceRevisionOf = (
  summary:
    | { maintenance?: LinkMaintenanceRestriction | null }
    | null
    | undefined
): number => summary?.maintenance?.revision ?? 0

const maintenanceIsOpen = (
  restriction: LinkMaintenanceRestriction | null | undefined
): boolean => !restriction?.restriction

const maintenanceIsSnoozed = (
  restriction: LinkMaintenanceRestriction | null | undefined
): boolean => restriction?.restriction === 'snoozed'

/**
 * A paused restriction whose resume time has passed. Callers re-read; they
 * do not submit a report from this predicate.
 */
export const maintenanceSnoozeExpired = (
  restriction: LinkMaintenanceRestriction | null | undefined,
  now = Date.now()
): boolean => {
  if (!maintenanceIsSnoozed(restriction) || !restriction?.resumesAt)
    return false
  const time = Date.parse(restriction.resumesAt)
  return Number.isFinite(time) && time <= now
}

/** Health view for one public read. It does not copy the resource object. */
export const healthViewFromLink = (
  patchId: number,
  resourceId: number,
  link: PatchResourceLink
): LinkHealthView | null => {
  const health = readLinkHealth(link)
  if (!health) return null
  return {
    patchId,
    resourceId,
    linkId: link.id,
    version: health.version,
    evidenceRound: health.evidenceRound,
    health: health.health,
    healthChangedAt: health.healthChangedAt,
    verifiedAt: health.verifiedAt,
    lastRelinkAt: health.lastRelinkAt,
    ownerType: health.ownerType,
    disputeSource: health.disputeSource,
    recentReportCount: health.recentReportCount,
    latestCheck: health.latestCheck,
    capabilities: health.capabilities,
    ...(health.maintenance ? { maintenance: health.maintenance } : {})
  }
}

/**
 * Maintenance revision merges on its own clock, and only after the caller has
 * rejected a different link version. A missing field is revision 0. At the
 * same revision an open re-read beats a stale snooze in either direction.
 */
export const mergeMaintenanceRestriction = (
  current: LinkMaintenanceRestriction | null | undefined,
  incoming: LinkMaintenanceRestriction | null | undefined
): LinkMaintenanceRestriction | undefined => {
  const currentRevision = current?.revision ?? 0
  const incomingRevision = incoming?.revision ?? 0
  if (incomingRevision > currentRevision) return incoming ?? undefined
  if (currentRevision > incomingRevision) return current ?? undefined
  if (maintenanceIsSnoozed(incoming) && maintenanceIsOpen(current)) {
    return current ?? undefined
  }
  if (maintenanceIsSnoozed(current) && maintenanceIsOpen(incoming)) {
    return incoming ?? undefined
  }
  return incoming ?? current ?? undefined
}

export const mergeHealthProjection = (
  server: PatchResourceHealthLink | null,
  update: LinkHealthSummary | null
): PatchResourceHealthLink | null => {
  if (!server) {
    return null
  }
  if (!update || update.version !== server.version) {
    return server
  }
  const healthSource = isHealthAtLeast(update, server) ? update : server
  const maintenance = mergeMaintenanceRestriction(
    server.maintenance,
    update.maintenance
  )
  const { maintenance: _ignored, ...healthFields } = healthSource
  const merged: PatchResourceHealthLink = { ...server, ...healthFields }
  if (maintenance) merged.maintenance = maintenance
  else delete merged.maintenance
  return merged
}

/** Same display fact the fold, count, status text and actions read. */
export const linkHealthForDisplay = (
  link: PatchResourceLink,
  update: LinkHealthSummary | null
): PatchResourceHealthLink | null =>
  mergeHealthProjection(readLinkHealth(link), update)

export const maintenanceRestrictionText = (
  restriction: LinkMaintenanceRestriction | null | undefined
): string | null => {
  if (!restriction?.restriction) return null
  if (restriction.restriction === 'stopped') {
    return LINK_MAINTENANCE_ERRORS.feedback_stopped.message
  }
  const until = restriction.resumesAt
    ? `，恢复时间 ${restriction.resumesAt}`
    : ''
  return `${LINK_MAINTENANCE_ERRORS.feedback_snoozed.message}${until}`
}

/**
 * Receipt copy comes only from the maintenance outcome. caseId is not a
 * proxy for whether the publisher was notified or the report was merged.
 */
export const linkReportOutcomeText = (
  outcome: LinkReportOutcome,
  receipt?: LinkMaintenanceReportReceipt | null
): string => {
  const base =
    outcome === 'recorded'
      ? '已记录一次报告'
      : outcome === 'renewed'
        ? '已更新你的报告'
        : '你已经报告过这条链接，本次不会重复计数'
  if (!receipt || receipt.event === 'none') return `${base}。`
  const notes: string[] = []
  if (receipt.publisherNotified) notes.push('已通知发布者')
  if (receipt.event === 'merged') notes.push('已合并到当前维护')
  return notes.length > 0 ? `${base}。${notes.join('，')}。` : `${base}。`
}
