/**
 * 列表行需要数字 id。备份行的 id 是 resourceId，合并行的 id 是用户卡片 id。
 * 字段以 types/api/officialMirror.ts 为准，这里不再逐字段解析响应。
 */

import type { BackupListItem, MergeListItem } from '~/types/api/officialMirror'

export {
  BACKUP_SORTS,
  BACKUP_TABS,
  IGNORE_REASON_MAX,
  MERGE_BATCH_MAX,
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
  MergeListItem,
  MergeListResponse,
  MergePreview,
  MergeResult,
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
