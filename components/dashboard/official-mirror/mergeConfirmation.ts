import type {
  MergeBatchResult,
  MergeResult,
  OfficialMirrorSection,
  PairClass
} from '~/types/api/officialMirror'
import {
  MERGE_BATCH_MAX,
  OFFICIAL_MIRROR_SECTIONS
} from '~/types/api/officialMirror'
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
 * 只有预览可合并、核对基点有效，并且管理员在确认框里明确勾选时才为 true。
 * 选中一行或打开预览都不算确认。
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
export const highConfidencePairs = <T extends ConfirmedMergePair>(
  pairs: readonly T[]
) => pairs.filter((pair) => pair.pairClass === 'high')

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

/** 批量合并清单的一项：确认时的基点与显示用的名称。 */
export type BatchListItem = ConfirmedMergePair & {
  userName: string
  staffName: string
  patchName: string
  section: OfficialMirrorSection
}

const positiveId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

const text = (value: unknown, max = 500) =>
  typeof value === 'string' ? value.slice(0, max) : ''

/**
 * 读回浏览器暂存的清单。只留下形状完整、已确认的高置信对，
 * 同一张用户卡片只留第一项，最多 MERGE_BATCH_MAX 项。
 */
export const acceptBatchListItems = (raw: unknown): BatchListItem[] => {
  if (!Array.isArray(raw)) return []
  const items: BatchListItem[] = []
  const users = new Set<number>()
  for (const value of raw) {
    if (items.length >= MERGE_BATCH_MAX) break
    if (!value || typeof value !== 'object') continue
    const item = value as Record<string, unknown>
    if (
      !positiveId(item.userResourceId) ||
      !positiveId(item.staffResourceId) ||
      item.userResourceId === item.staffResourceId ||
      typeof item.basis !== 'string' ||
      !isBackupBasis(item.basis) ||
      item.contentConfirmed !== true ||
      item.pairClass !== 'high' ||
      typeof item.patchUniqueId !== 'string' ||
      !positiveId(item.authorId) ||
      !(item.staffAuthorId === null || positiveId(item.staffAuthorId)) ||
      !OFFICIAL_MIRROR_SECTIONS.includes(item.section as OfficialMirrorSection)
    ) {
      continue
    }
    if (users.has(item.userResourceId)) continue
    users.add(item.userResourceId)
    items.push({
      userResourceId: item.userResourceId,
      staffResourceId: item.staffResourceId,
      basis: item.basis,
      contentConfirmed: true,
      pairClass: 'high',
      patchUniqueId: item.patchUniqueId,
      authorId: item.authorId,
      staffAuthorId: item.staffAuthorId as number | null,
      userName: text(item.userName),
      staffName: text(item.staffName),
      patchName: text(item.patchName),
      section: item.section as OfficialMirrorSection
    })
  }
  return items
}

export type BatchLineStatus =
  | 'merged'
  | 'skipped'
  | 'failed'
  | 'remaining'
  | 'unknown'

export type BatchResultLine = {
  key: string
  userResourceId: number
  staffResourceId: number
  userName: string
  staffName: string
  status: BatchLineStatus
  reason: string
  result: MergeResult | null
  authorIds: number[]
}

/** 按发出的清单顺序列出每一对的结果，名称取自清单。 */
export const batchResultLines = (
  sent: readonly BatchListItem[],
  result: MergeBatchResult
): BatchResultLine[] => {
  const outcomes = new Map(
    result.outcomes.map((item) => [
      mergePairKey(item.userResourceId, item.staffResourceId),
      item
    ])
  )
  const remaining = new Set(
    result.remaining.map((item) =>
      mergePairKey(item.userResourceId, item.staffResourceId)
    )
  )
  return sent.map((item) => {
    const key = mergePairKey(item.userResourceId, item.staffResourceId)
    const outcome = outcomes.get(key)
    const base = {
      key,
      userResourceId: item.userResourceId,
      staffResourceId: item.staffResourceId,
      userName: item.userName,
      staffName: item.staffName,
      authorIds: [item.authorId, item.staffAuthorId].filter(positiveId)
    }
    if (outcome?.status === 'merged') {
      return { ...base, status: 'merged', reason: '', result: outcome.result }
    }
    if (outcome?.status === 'skipped' || outcome?.status === 'failed') {
      return {
        ...base,
        status: outcome.status,
        reason: outcome.reason,
        result: null
      }
    }
    return {
      ...base,
      status: remaining.has(key) ? 'remaining' : 'unknown',
      reason: '',
      result: null
    }
  })
}

export const batchLineStatusText = (line: BatchResultLine) => {
  if (line.status === 'merged') return '已合并'
  if (line.status === 'skipped') return `已跳过：${line.reason || '原因未知'}`
  if (line.status === 'failed') return `失败：${line.reason || '原因未知'}`
  if (line.status === 'remaining') return '未开始'
  return '没有返回结果'
}

/**
 * 一次运行后留在清单里的项：没有开始的对（以及没有返回结果的对）留下，
 * 已经开始的对离开。运行期间新加入的项不受影响。
 */
export const itemsAfterBatch = <T extends ConfirmedMergePair>(
  current: readonly T[],
  lines: readonly BatchResultLine[]
) => {
  const started = new Set(
    lines
      .filter(
        (line) => line.status !== 'remaining' && line.status !== 'unknown'
      )
      .map((line) => line.key)
  )
  return current.filter(
    (item) =>
      !started.has(mergePairKey(item.userResourceId, item.staffResourceId))
  )
}
