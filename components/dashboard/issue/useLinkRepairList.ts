'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { kunFetchGet } from '~/utils/kunFetch'
import type { LinkHealthListResponse } from '~/types/api/linkHealth'

const PAGE_SIZE = 10

export interface UseLinkRepairListReturn {
  list: LinkHealthListResponse | null
  loading: boolean
  error: string
  page: number
  setPage: (page: number) => void
  refresh: () => void
}

/**
 * 发布者「链接待修复」数据源（模块 04）：`GET /api/patch/resource/link/health`
 * 只返回本人资源的非 ok 链接。纯前端只读；动作在列表组件里二次确认后提交。
 */
export function useLinkRepairList(enabled: boolean): UseLinkRepairListReturn {
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<{
    page: number
    value: LinkHealthListResponse | null
    error: string
  }>({ page: 0, value: null, error: '' })
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

  const fetchList = useCallback(async () => {
    if (!enabled) return
    const generation = ++generationRef.current
    setLoading(true)
    try {
      const res = await kunFetchGet<LinkHealthListResponse | string>(
        '/patch/resource/link/health',
        { page, limit: PAGE_SIZE }
      )
      if (!mountedRef.current || generation !== generationRef.current) return
      if (typeof res === 'string') {
        setResult({ page, value: null, error: res || '加载链接待修复失败' })
      } else {
        setResult({ page, value: res, error: '' })
      }
    } catch {
      if (!mountedRef.current || generation !== generationRef.current) return
      setResult({ page, value: null, error: '网络错误，列表加载失败，请重试' })
    } finally {
      if (mountedRef.current && generation === generationRef.current) {
        setLoading(false)
      }
    }
  }, [enabled, page])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  // 只暴露当前页的结果；过期页的旧数据不换标签复用。
  const current =
    result.page === page ? result : { page, value: null, error: '' }

  return {
    list: enabled ? current.value : null,
    loading: enabled ? loading : false,
    error: enabled ? current.error : '',
    page,
    setPage,
    refresh: fetchList
  }
}
