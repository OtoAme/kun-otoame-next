'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { kunFetchGet } from '~/utils/kunFetch'
import type { AdminLinkHealthListResponse } from '~/types/api/linkHealth'

const PAGE_SIZE = 20

export interface AdminLinkHealthFilters {
  ownerType: 'publisher' | 'staff' | ''
  hasTouchgalLink: 'true' | 'false' | ''
  hostname: string
  otherHost: boolean
  minBrokenDays: string
}

export const EMPTY_ADMIN_LINK_HEALTH_FILTERS: AdminLinkHealthFilters = {
  ownerType: '',
  hasTouchgalLink: '',
  hostname: '',
  otherHost: false,
  minBrokenDays: ''
}

export interface UseAdminLinkHealthReturn {
  list: AdminLinkHealthListResponse | null
  loading: boolean
  error: string
  page: number
  filters: AdminLinkHealthFilters
  appliedFilters: AdminLinkHealthFilters
  setFilters: (filters: AdminLinkHealthFilters) => void
  applyFilters: () => void
  setPage: (page: number) => void
  refresh: () => void
}

const buildQuery = (
  filters: AdminLinkHealthFilters,
  page: number
): Record<string, string | number> => {
  const query: Record<string, string | number> = { page, limit: PAGE_SIZE }
  if (filters.ownerType) query.ownerType = filters.ownerType
  if (filters.hasTouchgalLink) query.hasTouchgalLink = filters.hasTouchgalLink
  if (filters.otherHost) {
    query.otherHost = 'true'
  } else if (filters.hostname.trim()) {
    query.hostname = filters.hostname.trim().toLowerCase()
  }
  const days = Number(filters.minBrokenDays)
  if (Number.isSafeInteger(days) && days > 0) query.minBrokenDays = days
  return query
}

/**
 * 站方只读「已失效链接」视图数据源（GET /api/admin/link-health）。筛选需
 * 显式应用，应用即回到第一页；过期响应不换标签复用。
 */
export function useAdminLinkHealth(): UseAdminLinkHealthReturn {
  const [page, setPageState] = useState(1)
  const [filters, setFilters] = useState(EMPTY_ADMIN_LINK_HEALTH_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState(
    EMPTY_ADMIN_LINK_HEALTH_FILTERS
  )
  const [result, setResult] = useState<{
    key: string
    list: AdminLinkHealthListResponse | null
    error: string
  }>({ key: '', list: null, error: '' })
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)
  const generationRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
    }
  }, [])

  const query = buildQuery(appliedFilters, page)
  const queryKey = JSON.stringify(query)

  const fetchList = useCallback(async () => {
    const generation = ++generationRef.current
    const key = queryKey
    setLoading(true)
    try {
      const res = await kunFetchGet<AdminLinkHealthListResponse | string>(
        '/admin/link-health',
        query
      )
      if (!mountedRef.current || generation !== generationRef.current) return
      if (typeof res === 'string') {
        setResult({ key, list: null, error: res || '加载已失效链接失败' })
      } else {
        setResult({ key, list: res, error: '' })
      }
    } catch {
      if (!mountedRef.current || generation !== generationRef.current) return
      setResult({ key, list: null, error: '网络错误，列表加载失败，请重试' })
    } finally {
      if (mountedRef.current && generation === generationRef.current) {
        setLoading(false)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  const setPage = useCallback((next: number) => {
    setPageState(Math.max(1, next))
  }, [])

  const applyFilters = useCallback(() => {
    setPageState(1)
    setAppliedFilters(filters)
  }, [filters])

  const current =
    result.key === queryKey ? result : { key: queryKey, list: null, error: '' }

  return {
    list: current.list,
    loading,
    error: current.error,
    page,
    filters,
    appliedFilters,
    setFilters,
    applyFilters,
    setPage,
    refresh: fetchList
  }
}
