import type { MergeBatchResult, PairClass } from '~/types/api/officialMirror'
import { MERGE_BATCH_MAX } from '~/types/api/officialMirror'
import { isBackupBasis } from './contract'

export type ConfirmedMergePair = {
  userResourceId: number
  staffResourceId: number
  basis: string
  contentConfirmed: true
  pairClass: PairClass
  patchUniqueId: string
  authorId: number
  staffAuthorId: number | null
}

export const mergePairKey = (userResourceId: number, staffResourceId: number) =>
  `${userResourceId}:${staffResourceId}`

/**
 * 勾选列表或全选不会确认内容。
 * 只有预览可合并、核对基点有效，并且管理员明确勾选时才为 true。
 */
export const confirmPairContent = (input: {
  checked: boolean
  canMerge: boolean
  basis: string
  userResourceId: number
  staffResourceId: number
  pairClass: PairClass
  patchUniqueId: string
  authorId: number
  staffAuthorId?: number | null
}): ConfirmedMergePair | null => {
  if (!input.checked || !input.canMerge || !isBackupBasis(input.basis)) {
    return null
  }
  if (input.pairClass !== 'high' && input.pairClass !== 'manual') return null
  const staffAuthorId =
    typeof input.staffAuthorId === 'number' &&
    Number.isSafeInteger(input.staffAuthorId) &&
    input.staffAuthorId > 0
      ? input.staffAuthorId
      : null
  return {
    userResourceId: input.userResourceId,
    staffResourceId: input.staffResourceId,
    basis: input.basis,
    contentConfirmed: true,
    pairClass: input.pairClass,
    patchUniqueId: input.patchUniqueId,
    authorId: input.authorId,
    staffAuthorId
  }
}

/** 批量只提交已确认的高置信对。人工对留在单对入口。 */
export const highConfidencePairs = (pairs: readonly ConfirmedMergePair[]) =>
  pairs.filter((pair) => pair.pairClass === 'high')

export const batchRequestPairs = (pairs: readonly ConfirmedMergePair[]) => {
  const high = highConfidencePairs(pairs)
  if (high.length < 1 || high.length > MERGE_BATCH_MAX) return null
  return high.map((pair) => ({
    userResourceId: pair.userResourceId,
    staffResourceId: pair.staffResourceId,
    basis: pair.basis,
    contentConfirmed: true as const
  }))
}

export const batchReportLines = (result: MergeBatchResult) => {
  const lines = result.outcomes.map((item) => {
    const pair = `#${item.userResourceId} / #${item.staffResourceId}`
    if (item.status === 'merged') {
      return `${pair} 已合并，保留 #${item.result.resourceId}`
    }
    if (item.status === 'skipped') return `${pair} 未合并：${item.reason}`
    return `${pair} 失败：${item.reason}`
  })
  for (const item of result.remaining) {
    lines.push(`#${item.userResourceId} / #${item.staffResourceId} 未开始`)
  }
  return lines
}
