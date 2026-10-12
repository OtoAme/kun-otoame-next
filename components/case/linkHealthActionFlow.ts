import type { LinkHealthBasis, LinkHealthView } from '~/types/api/linkHealth'

/** 链接健康动作的请求分类（检查、归属方核实/确认失效、站方争议裁决）。 */
export type LinkHealthPendingAction =
  | { kind: 'verify' }
  | { kind: 'confirm_broken' }
  | { kind: 'resolve'; action: 'available' | 'broken' }
  | { kind: 'check' }

const OWNER_LABELS = {
  verify: '我已核实可用',
  confirm_broken: '确认失效'
} as const

export const linkHealthActionLabel = (
  pending: LinkHealthPendingAction
): string => {
  switch (pending.kind) {
    case 'verify':
      return OWNER_LABELS.verify
    case 'confirm_broken':
      return OWNER_LABELS.confirm_broken
    case 'resolve':
      return pending.action === 'available' ? '判定可用' : '判定失效'
    case 'check':
      return '检测链接'
  }
}

export const linkHealthActionConfirmText = (
  pending: LinkHealthPendingAction
): string => {
  switch (pending.kind) {
    case 'verify':
      return '确认你已经实际打开并核对了这条链接当前可以取得文件？同一链接版本 30 天内只能核实一次。'
    case 'confirm_broken':
      return '确认这条链接已经失效？链接会标记为已失效并从卡片折叠。'
    case 'resolve':
      return pending.action === 'available'
        ? '以站方身份打开并核对后，确认这条链接当前可用？争议将按判定结果结案。'
        : '以站方身份打开并核对后，确认这条链接已经失效？链接会标记为已失效并折叠，争议将结案。'
    case 'check':
      return '检测会由服务器实际访问这条链接，结果可能更新链接状态；检测失败会记为无法判断。是否继续？'
  }
}

export interface LinkHealthActionRequest {
  url: string
  /** kunFetch 契约（JSON body）；字段构成见各分支。 */
  body: Record<string, unknown>
}

/** 端点由动作类别决定；body 始终是完整期望基点（服务端锁内重验）。 */
export const linkHealthActionRequest = (
  pending: LinkHealthPendingAction,
  basis: LinkHealthBasis
): LinkHealthActionRequest => {
  if (pending.kind === 'resolve') {
    return {
      url: '/admin/link-health/resolve',
      body: { ...basis, action: pending.action }
    }
  }
  if (pending.kind === 'check') {
    return { url: '/patch/resource/link-check', body: { ...basis } }
  }
  return {
    url: '/patch/resource/link/health',
    body: { ...basis, action: pending.kind }
  }
}

/** 事项详情 linkHealth 视图 → 完整期望基点。 */
export const linkBasisFromView = (view: LinkHealthView): LinkHealthBasis => ({
  patchId: view.patchId,
  resourceId: view.resourceId,
  linkId: view.linkId,
  linkVersion: view.version,
  evidenceRound: view.evidenceRound,
  health: view.health,
  healthChangedAt: view.healthChangedAt
})

/** B 尚未把 linkHealth 字段并入 CaseDetail 类型时的防卫读取（W00 §11.1 已定字段名）。 */
export const readCaseLinkHealth = (detail: unknown): LinkHealthView | null => {
  const candidate = (detail as { linkHealth?: LinkHealthView | null })
    ?.linkHealth
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    typeof candidate.linkId !== 'number' ||
    typeof candidate.version !== 'number' ||
    typeof candidate.capabilities !== 'object' ||
    candidate.capabilities === null
  ) {
    return null
  }
  return candidate
}
