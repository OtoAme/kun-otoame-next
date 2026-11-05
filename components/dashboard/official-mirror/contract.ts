/**
 * 列表行需要数字 id。备份行的 id 是 resourceId，合并行的 id 是用户卡片 id。
 * 字段以 types/api/officialMirror.ts 为准，这里只核对界面依赖的身份与形状。
 */

import type {
  BackupListItem,
  MergeDismissCardResult,
  MergeListItem,
  MergeOptionsResponse,
  MergePreview,
  MergeTab
} from '~/types/api/officialMirror'
import { MERGE_TABS } from '~/types/api/officialMirror'

export {
  BACKUP_SORTS,
  BACKUP_TABS,
  IGNORE_REASON_MAX,
  MERGE_BATCH_MAX,
  MERGE_DISMISS_CARD_MAX,
  MERGE_SORTS,
  MERGE_TABS,
  PAIR_CLASSES
} from '~/types/api/officialMirror'

export type {
  BackupDetail,
  BackupListItem,
  BackupListResponse,
  BackupMutationResult,
  BackupTab,
  MergeBatchResult,
  MergeDismissCardResult,
  MergeHistoryEntry,
  MergeListItem,
  MergeListResponse,
  MergeOption,
  MergeOptionsResponse,
  MergePreview,
  MergeResult,
  MergeSignalCheck,
  MergeSort,
  MergeTab,
  OfficialMirrorBlock,
  OfficialMirrorResolveHit,
  PairClass
} from '~/types/api/officialMirror'

export const BACKUP_BASIS_PATTERN = /^[a-f0-9]{64}$/

export type BackupListRow = BackupListItem & { id: number }
export type MergeListRow = MergeListItem & { id: number }

const positiveId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const isBackupBasis = (value: string) => BACKUP_BASIS_PATTERN.test(value)

export const acceptBackupListRow = (value: unknown): BackupListRow | null => {
  if (!value || typeof value !== 'object') return null
  const resourceId = (value as { resourceId?: unknown }).resourceId
  if (!positiveId(resourceId)) return null
  return { ...(value as BackupListItem), id: resourceId }
}

export const acceptMergeListRow = (value: unknown): MergeListRow | null => {
  if (!value || typeof value !== 'object') return null
  const id = (value as { userResource?: { id?: unknown } }).userResource?.id
  if (!positiveId(id)) return null
  return { ...(value as MergeListItem), id }
}

/** Tab counts of a list response; null when the response has none. */
export const mergeListCounts = (
  response: Record<string, unknown> | null
): Record<MergeTab, number> | null => {
  const counts = response?.counts
  if (!isRecord(counts)) return null
  const result = {} as Record<MergeTab, number>
  for (const tab of MERGE_TABS) {
    const value = counts[tab]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return null
    }
    result[tab] = value
  }
  return result
}

/** The options response of exactly this user card, or null. */
export const acceptMergeOptions = (
  body: unknown,
  userResourceId: number
): MergeOptionsResponse | null => {
  if (!isRecord(body) || !isRecord(body.user)) return null
  if (body.user.id !== userResourceId) return null
  if (!Array.isArray(body.options) || !Array.isArray(body.history)) return null
  const optionsOk = body.options.every(
    (option) =>
      isRecord(option) &&
      isRecord(option.staff) &&
      positiveId(option.staff.id) &&
      Array.isArray(option.signals) &&
      Array.isArray(option.blocks)
  )
  return optionsOk ? (body as unknown as MergeOptionsResponse) : null
}

/** The preview of exactly this pair, or null. */
export const acceptMergePreview = (
  body: unknown,
  pair: { userResourceId: number; staffResourceId: number }
): MergePreview | null => {
  if (!isRecord(body) || !isRecord(body.user) || !isRecord(body.staff)) {
    return null
  }
  if (
    body.user.id !== pair.userResourceId ||
    body.staff.id !== pair.staffResourceId
  ) {
    return null
  }
  if (
    typeof body.basis !== 'string' ||
    typeof body.canMerge !== 'boolean' ||
    !Array.isArray(body.blocks) ||
    !Array.isArray(body.exitedPairs) ||
    !isRecord(body.survivorPreview) ||
    !Array.isArray(body.survivorPreview.links)
  ) {
    return null
  }
  return body as unknown as MergePreview
}

export const acceptDismissCardResult = (
  body: unknown
): MergeDismissCardResult | null => {
  if (!isRecord(body) || typeof body.changed !== 'boolean') return null
  if (
    !Array.isArray(body.dismissed) ||
    !Array.isArray(body.unchanged) ||
    !Array.isArray(body.skipped)
  ) {
    return null
  }
  return body as unknown as MergeDismissCardResult
}

const queueListeners = new Set<() => void>()

export const subscribeOfficialMirrorQueue = (listener: () => void) => {
  queueListeners.add(listener)
  return () => {
    queueListeners.delete(listener)
  }
}

export const notifyOfficialMirrorQueue = () => {
  queueListeners.forEach((listener) => listener())
}

/** 预览序号或资源对变了，就不用这次响应覆盖当前预览。 */
export const shouldApplyPreview = (
  request: { seq: number; userResourceId: number; staffResourceId: number },
  current: { seq: number; userResourceId: number; staffResourceId: number }
) =>
  request.seq === current.seq &&
  request.userResourceId === current.userResourceId &&
  request.staffResourceId === current.staffResourceId
