'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { kunFetchPost } from '~/utils/kunFetch'
import type {
  MergeBatchResult,
  OfficialMirrorCacheRefresh
} from '~/types/api/officialMirror'
import { MERGE_BATCH_MAX } from '~/types/api/officialMirror'
import { cacheRefreshBody, type CacheRefreshRequest } from '../cacheRefresh'
import { notifyOfficialMirrorQueue } from '../contract'
import {
  acceptBatchListItems,
  batchRequestPairs,
  batchResultLines,
  itemsAfterBatch,
  mergePairKey,
  type BatchListItem,
  type BatchResultLine
} from '../mergeConfirmation'

/** sessionStorage key; the list lives as long as this browser tab. */
export const MERGE_BATCH_STORAGE_KEY = 'otoame:resource-merge-batch:v1'

export type BatchCacheState = {
  cacheRefreshed: boolean
  retry: CacheRefreshRequest | null
  pending: boolean
  error: string
}

export type BatchRunLine = BatchResultLine & { cache: BatchCacheState | null }

export type BatchRun = { seq: number; lines: BatchRunLine[] }

const readStored = (): BatchListItem[] => {
  try {
    const raw = window.sessionStorage.getItem(MERGE_BATCH_STORAGE_KEY)
    return raw ? acceptBatchListItems(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

const cacheOf = (line: BatchResultLine): BatchCacheState | null => {
  const result = line.result
  if (
    line.status !== 'merged' ||
    !result ||
    typeof result.cacheRefreshed !== 'boolean'
  ) {
    return null
  }
  return {
    cacheRefreshed: result.cacheRefreshed,
    retry: result.cacheRefreshed
      ? null
      : cacheRefreshBody({
          patchUniqueId: result.patchUniqueId,
          authorIds: line.authorIds
        }),
    pending: false,
    error: ''
  }
}

/**
 * 批量合并清单。每项带着加入时确认的基点，原样提交；
 * 只收高置信对，同一张用户卡片只留一项，最多 MERGE_BATCH_MAX 项。
 */
export function useMergeBatchList({
  onFinished
}: {
  /** Called once per run that returned outcomes. */
  onFinished: (lines: BatchRunLine[]) => void
}) {
  const [items, setItems] = useState<BatchListItem[]>([])
  // State rather than a ref: a replayed effect still reads `false` from its
  // own render and cannot overwrite the stored list with the empty start.
  const [ready, setReady] = useState(false)
  const [run, setRun] = useState<BatchRun | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const seqRef = useRef(0)
  const runRef = useRef<BatchRun | null>(null)
  runRef.current = run
  const finishedRef = useRef(onFinished)
  finishedRef.current = onFinished

  useEffect(() => {
    if (!ready) return
    try {
      window.sessionStorage.setItem(
        MERGE_BATCH_STORAGE_KEY,
        JSON.stringify(items)
      )
    } catch {
      // Storage full or blocked: the list still works for this page view.
    }
  }, [items, ready])

  useEffect(() => {
    setItems(readStored())
    setReady(true)
  }, [])

  const has = useCallback(
    (userResourceId: number, staffResourceId: number, basis?: string) =>
      items.some(
        (item) =>
          item.userResourceId === userResourceId &&
          item.staffResourceId === staffResourceId &&
          (basis === undefined || item.basis === basis)
      ),
    [items]
  )

  /** Adds or replaces the item of this user card. False when it cannot. */
  const add = useCallback(
    (item: BatchListItem) => {
      if (item.pairClass !== 'high' || item.contentConfirmed !== true) {
        return false
      }
      const replaces = items.some(
        (current) => current.userResourceId === item.userResourceId
      )
      if (!replaces && items.length >= MERGE_BATCH_MAX) return false
      setItems((current) => [
        ...current.filter(
          (other) => other.userResourceId !== item.userResourceId
        ),
        item
      ])
      return true
    },
    [items]
  )

  const remove = useCallback(
    (userResourceId: number, staffResourceId: number) =>
      setItems((current) =>
        current.filter(
          (item) =>
            mergePairKey(item.userResourceId, item.staffResourceId) !==
            mergePairKey(userResourceId, staffResourceId)
        )
      ),
    []
  )

  const removeUser = useCallback(
    (userResourceId: number) =>
      setItems((current) =>
        current.filter((item) => item.userResourceId !== userResourceId)
      ),
    []
  )

  const clear = useCallback(() => setItems([]), [])

  const start = async (): Promise<boolean> => {
    if (pending) return false
    const sent = items.filter((item) => item.pairClass === 'high')
    const pairs = batchRequestPairs(sent)
    if (!pairs) {
      setError(
        sent.length > MERGE_BATCH_MAX
          ? `一次最多合并 ${MERGE_BATCH_MAX} 对`
          : '清单里没有可以合并的配对'
      )
      return false
    }
    const seq = seqRef.current + 1
    seqRef.current = seq
    setPending(true)
    setError('')
    try {
      const response = await kunFetchPost<MergeBatchResult | string>(
        '/admin/resource-merges/batch',
        { pairs }
      )
      if (seq !== seqRef.current) return false
      if (typeof response === 'string') {
        setError(response || '批量合并失败，请稍后重试')
        return false
      }
      if (
        !response ||
        !Array.isArray(response.outcomes) ||
        !Array.isArray(response.remaining)
      ) {
        setError('没有确认这批合并的结果，请刷新核对后再操作')
        return false
      }
      const lines = batchResultLines(sent, response).map((line) => ({
        ...line,
        cache: cacheOf(line)
      }))
      setRun({ seq, lines })
      setItems((current) => itemsAfterBatch(current, lines))
      notifyOfficialMirrorQueue()
      finishedRef.current(lines)
      return true
    } catch {
      if (seq === seqRef.current) setError('网络错误，请稍后重试')
      return false
    } finally {
      if (seq === seqRef.current) setPending(false)
    }
  }

  const patchLine = (
    seq: number,
    key: string,
    next: (cache: BatchCacheState) => BatchCacheState
  ) =>
    setRun((current) => {
      if (!current || current.seq !== seq) return current
      return {
        ...current,
        lines: current.lines.map((line) =>
          line.key === key && line.cache
            ? { ...line, cache: next(line.cache) }
            : line
        )
      }
    })

  /** Replays only the cache refresh of one merged pair. */
  const retryCache = async (key: string) => {
    const current = runRef.current
    const line = current?.lines.find((item) => item.key === key)
    const retry = line?.cache?.retry
    if (!current || !line?.cache || !retry || line.cache.pending) return
    const seq = current.seq
    patchLine(seq, key, (cache) => ({ ...cache, pending: true, error: '' }))
    try {
      const response = await kunFetchPost<OfficialMirrorCacheRefresh | string>(
        '/admin/backup/refresh-cache',
        retry
      )
      if (typeof response === 'string') {
        patchLine(seq, key, (cache) => ({
          ...cache,
          pending: false,
          error: response || '刷新缓存失败，请稍后重试'
        }))
        return
      }
      if (
        response?.cacheRefreshed !== true ||
        response.uniqueIds?.[0] !== retry.uniqueIds[0]
      ) {
        patchLine(seq, key, (cache) => ({
          ...cache,
          pending: false,
          error: '页面缓存仍未刷新'
        }))
        return
      }
      patchLine(seq, key, () => ({
        cacheRefreshed: true,
        retry: null,
        pending: false,
        error: ''
      }))
    } catch {
      patchLine(seq, key, (cache) => ({
        ...cache,
        pending: false,
        error: '网络错误，缓存没有刷新'
      }))
    }
  }

  return {
    items,
    has,
    add,
    remove,
    removeUser,
    clear,
    start,
    pending,
    error,
    clearError: () => setError(''),
    run,
    retryCache: (key: string) => void retryCache(key),
    closeRun: () => setRun(null)
  }
}

export type MergeBatchList = ReturnType<typeof useMergeBatchList>
