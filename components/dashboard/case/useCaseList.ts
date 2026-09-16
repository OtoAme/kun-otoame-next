'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { kunFetchGet } from '~/utils/kunFetch'
import type {
  AdminCaseListItem,
  AdminCaseListResponse,
  CaseStatusCounts
} from '~/types/api/case'

import type { CaseListParams } from './caseCenterViews'

export interface CaseListQuery {
  /** Status selection of the active view; at most one status parameter. */
  params: CaseListParams
  kind: string
  search: string
  page: number
  limit: number
}

export interface CaseListState {
  /** Response of the standing query only; null while none has arrived. */
  list: AdminCaseListResponse | null
  rows: AdminCaseListItem[]
  /** Rows as of the latest render, for callbacks that must not re-subscribe. */
  rowsRef: React.MutableRefObject<AdminCaseListItem[]>
  /** Survives status/page changes, so navigation badges never blank out. */
  statusCounts: CaseStatusCounts | null
  loading: boolean
  error: string
  refetch: () => void
}

/**
 * Admin case list fetching with the two guards this queue needs:
 *
 * - a generation counter, so a slow response for an abandoned filter can
 *   neither overwrite a newer one nor write after unmount;
 * - query-key gating, so rows and errors belonging to an older filter are
 *   hidden rather than relabelled as the current filter's result.
 *
 * `statusCounts` is cached against a narrower key than the rows: the server
 * scopes it by kind and search only, so it stays correct while a status or
 * page change is still in flight.
 */
export function useCaseList(query: CaseListQuery): CaseListState {
  const { params, kind, search, page, limit } = query
  const queryKey = JSON.stringify([params, kind, search, page, limit])
  const scopeKey = JSON.stringify([kind, search])

  const [listState, setListState] = useState<{
    queryKey: string
    data: AdminCaseListResponse
  } | null>(null)
  const [countsState, setCountsState] = useState<{
    scopeKey: string
    data: CaseStatusCounts
  } | null>(null)
  const [errorState, setErrorState] = useState<{
    queryKey: string
    message: string
  } | null>(null)
  const [loading, setLoading] = useState(true)

  const mountedRef = useRef(true)
  const generationRef = useRef(0)
  const rowsRef = useRef<AdminCaseListItem[]>([])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
    }
  }, [])

  const fetchList = useCallback(async () => {
    const generation = ++generationRef.current
    setLoading(true)
    setErrorState(null)
    try {
      const res = await kunFetchGet<AdminCaseListResponse | string>(
        '/admin/case',
        {
          // 未选状态/类型/搜索时不发送对应参数，默认即站方未结队列
          ...params,
          ...(kind ? { kind } : {}),
          ...(search ? { search } : {}),
          page,
          limit
        }
      )
      if (!mountedRef.current || generation !== generationRef.current) return
      if (typeof res === 'string') {
        setErrorState({ queryKey, message: res || '加载事项列表失败' })
      } else {
        setListState({ queryKey, data: res })
        setCountsState({ scopeKey, data: res.statusCounts })
      }
    } catch {
      if (!mountedRef.current || generation !== generationRef.current) return
      setErrorState({ queryKey, message: '网络错误，列表加载失败，请重试' })
    } finally {
      if (mountedRef.current && generation === generationRef.current) {
        setLoading(false)
      }
    }
  }, [params, kind, search, page, limit, queryKey, scopeKey])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  // Stable identity: callers hold it in their own useCallback dependencies.
  const refetch = useCallback(() => {
    void fetchList()
  }, [fetchList])

  const list = listState?.queryKey === queryKey ? listState.data : null
  const rows = list?.cases ?? []
  rowsRef.current = rows

  return {
    list,
    rows,
    rowsRef,
    statusCounts: countsState?.scopeKey === scopeKey ? countsState.data : null,
    loading,
    error: errorState?.queryKey === queryKey ? errorState.message : '',
    refetch
  }
}
