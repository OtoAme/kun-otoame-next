'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Select, SelectItem, Tab, Tabs } from '@heroui/react'
import { kunFetchGet } from '~/utils/kunFetch'
import { KunLoading } from '~/components/kun/Loading'
import { KunNull } from '~/components/kun/Null'
import { KunPagination } from '~/components/kun/Pagination'
import { CaseListCard } from './CaseListCard'
import {
  CASE_STATUS_LABELS,
  type CaseStatus,
  type CaseTab
} from '~/constants/case'
import type { CaseListResponse } from '~/types/api/case'

const PAGE_SIZE = 20

const CASE_TAB_TITLES: Record<CaseTab, string> = {
  reported: '我提交的',
  owned: '待我处理',
  subscribed: '我关注的'
}

/** merged 由后续模块保留，本模块不产生，不进入筛选。 */
const FILTERABLE_STATUSES: CaseStatus[] = [
  'open',
  'waiting_reporter',
  'waiting_owner',
  'resolved',
  'rejected'
]

interface ListState {
  queryKey: string
  data: CaseListResponse
}

interface ListError {
  queryKey: string
  message: string
}

export const CaseTabsContainer = () => {
  const [tab, setTab] = useState<CaseTab>('reported')
  const [status, setStatus] = useState<CaseStatus | ''>('')
  const [page, setPage] = useState(1)
  const [listState, setListState] = useState<ListState | null>(null)
  const [listError, setListError] = useState<ListError | null>(null)
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

  const currentQueryKey = JSON.stringify([tab, status, page])

  const fetchList = useCallback(async () => {
    const generation = ++generationRef.current
    const queryKey = JSON.stringify([tab, status, page])
    setLoading(true)
    setListError(null)
    try {
      const res = await kunFetchGet<CaseListResponse | string>('/case', {
        tab,
        // 未选状态时不发送 status 参数
        ...(status ? { status } : {}),
        page,
        limit: PAGE_SIZE
      })
      if (!mountedRef.current || generation !== generationRef.current) return
      if (typeof res === 'string') {
        setListError({ queryKey, message: res || '加载列表失败' })
      } else {
        setListState({ queryKey, data: res })
      }
    } catch {
      if (!mountedRef.current || generation !== generationRef.current) return
      setListError({ queryKey, message: '网络错误，列表加载失败，请重试' })
    } finally {
      if (mountedRef.current && generation === generationRef.current) {
        setLoading(false)
      }
    }
  }, [tab, status, page])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  const list = listState?.queryKey === currentQueryKey ? listState.data : null
  const error =
    listError?.queryKey === currentQueryKey ? listError.message : null
  const totalPages = list ? Math.max(1, Math.ceil(list.total / list.limit)) : 1

  const handleTabChange = (key: React.Key) => {
    setTab(key as CaseTab)
    setPage(1)
  }

  const handleStatusChange = (keys: 'all' | Set<React.Key>) => {
    if (keys === 'all') return
    const value = Array.from(keys)[0]
    setStatus(typeof value === 'string' ? (value as CaseStatus) : '')
    setPage(1)
  }

  return (
    <div className="container mx-auto my-8 max-w-3xl space-y-4 px-4">
      <h1 className="text-2xl font-medium">问题处理</h1>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          aria-label="问题处理分页"
          selectedKey={tab}
          onSelectionChange={handleTabChange}
        >
          {(Object.keys(CASE_TAB_TITLES) as CaseTab[]).map((key) => (
            <Tab key={key} title={CASE_TAB_TITLES[key]} />
          ))}
        </Tabs>
        <Select
          aria-label="按状态筛选"
          className="w-36"
          size="sm"
          selectedKeys={status ? [status] : ['']}
          onSelectionChange={handleStatusChange}
        >
          {[
            { key: '', label: '全部状态' },
            ...FILTERABLE_STATUSES.map((value) => ({
              key: value,
              label: CASE_STATUS_LABELS[value]
            }))
          ].map((option) => (
            <SelectItem key={option.key}>{option.label}</SelectItem>
          ))}
        </Select>
      </div>

      {list && list.cases.length > 0 ? (
        <ul className="space-y-3" aria-label="事项列表">
          {list.cases.map((item) => (
            <li key={item.id}>
              <CaseListCard item={item} />
            </li>
          ))}
        </ul>
      ) : loading ? (
        <KunLoading hint="正在获取问题处理列表..." />
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
          <Button variant="bordered" size="sm" onPress={() => void fetchList()}>
            重试
          </Button>
        </div>
      ) : (
        <KunNull message="这里空空如也，没有相关的问题记录" />
      )}

      {list && list.total > list.limit && (
        <div className="flex justify-center">
          <KunPagination
            total={totalPages}
            page={page}
            onPageChange={setPage}
            isLoading={loading}
          />
        </div>
      )}
    </div>
  )
}
