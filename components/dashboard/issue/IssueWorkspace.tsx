'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, MessagesSquare, RefreshCw } from 'lucide-react'

import { Button } from '~/components/dashboard/ui/button'
import { Card, CardContent } from '~/components/dashboard/ui/card'
import { Tabs, TabsList, TabsTrigger } from '~/components/dashboard/ui/tabs'
import { kunFetchGet } from '~/utils/kunFetch'
import { CASE_TABS } from '~/constants/case'
import { cn } from '~/lib/dashboard/utils'
import type { CaseListItem, CaseListResponse, CaseTab } from '~/types/api/case'

import { IssueCaseDetail } from './IssueCaseDetail'
import { IssueCaseList } from './IssueCaseList'
import {
  parseStatusFilter,
  statusFilterStatuses,
  type StatusFilterKey
} from './issueFilters'

const PAGE_SIZE = 20
const PG_INT_MAX = 2147483647

/** 计划文档 D4 定下的三个归属分页。 */
const CASE_TAB_LABELS: Record<CaseTab, string> = {
  reported: '我提交的',
  owned: '待我处理',
  subscribed: '我关注的'
}

const CASE_TAB_SET: ReadonlySet<string> = new Set(CASE_TABS)

const parseTab = (raw: string | null): CaseTab =>
  raw !== null && CASE_TAB_SET.has(raw) ? (raw as CaseTab) : 'reported'

const parsePage = (raw: string | null): number => {
  const page = Number(raw)
  return Number.isSafeInteger(page) && page >= 1 && page <= PG_INT_MAX
    ? page
    : 1
}

const parseSelection = (raw: string | null): number | null => {
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) && id <= PG_INT_MAX ? id : null
}

export function IssueWorkspace() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const tab = parseTab(searchParams.get('tab'))
  const statusKey = parseStatusFilter(searchParams.get('status'))
  const page = parsePage(searchParams.get('page'))
  const selectedId = parseSelection(searchParams.get('id'))
  const hasSelection = selectedId !== null

  const statusesParam = statusFilterStatuses(statusKey).join(',')

  const currentQueryKey = JSON.stringify([tab, statusesParam, page])
  const [listState, setListState] = useState<{
    queryKey: string
    data: CaseListResponse
  } | null>(null)
  const [listError, setListError] = useState<{
    queryKey: string
    message: string
  } | null>(null)
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
    const generation = ++generationRef.current
    const queryKey = JSON.stringify([tab, statusesParam, page])
    setLoading(true)
    setListError(null)
    try {
      const res = await kunFetchGet<CaseListResponse | string>('/case', {
        tab,
        // 「全部」不发送状态参数
        ...(statusesParam ? { statuses: statusesParam } : {}),
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
  }, [tab, statusesParam, page])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  // Only rows/errors belonging to the standing query are exposed; a stale
  // response keyed to an older filter is hidden rather than relabeled.
  const list = listState?.queryKey === currentQueryKey ? listState.data : null
  const error = listError?.queryKey === currentQueryKey ? listError.message : ''
  const rows: CaseListItem[] = list?.cases ?? []

  const buildHref = useCallback(
    (patch: {
      tab?: CaseTab
      status?: StatusFilterKey
      page?: number
      selection?: number | null
    }) => {
      const next = {
        tab: patch.tab ?? tab,
        status: patch.status ?? statusKey,
        page: patch.page ?? page,
        selection: patch.selection === undefined ? selectedId : patch.selection
      }
      const query = new URLSearchParams()
      if (next.tab !== 'reported') query.set('tab', next.tab)
      if (next.status !== 'all') query.set('status', next.status)
      if (next.page > 1) query.set('page', String(next.page))
      if (next.selection !== null) query.set('id', String(next.selection))
      const search = query.toString()
      return search ? `${pathname}?${search}` : pathname
    },
    [tab, statusKey, page, selectedId, pathname]
  )

  const navigate = useCallback(
    (
      patch: Parameters<typeof buildHref>[0],
      mode: 'push' | 'replace' = 'push'
    ) => {
      const href = buildHref(patch)
      if (mode === 'replace') router.replace(href, { scroll: false })
      else router.push(href, { scroll: false })
    },
    [buildHref, router]
  )

  // A filter change is a new result set: back to page 1, and the open detail
  // may no longer belong to it, so the selection is cleared with it.
  const handleTabChange = (value: string) => {
    navigate({ tab: parseTab(value), page: 1, selection: null })
  }
  const handleStatusChange = (key: StatusFilterKey) => {
    navigate({ status: key, page: 1, selection: null })
  }
  const handlePageChange = (nextPage: number) => {
    navigate({ page: Math.max(1, nextPage), selection: null })
  }
  const clearSelection = useCallback(
    () => navigate({ selection: null }),
    [navigate]
  )

  // Hand-edited or shrunk tail page: resolve to the real last page once the
  // standing query reports its total. Never leaves page 1 for an empty filter.
  useEffect(() => {
    if (!list) return
    if (page > 1 && rows.length === 0 && list.total > 0) {
      navigate(
        { page: Math.max(1, Math.ceil(list.total / PAGE_SIZE)) },
        'replace'
      )
    }
  }, [list, page, rows.length, navigate])

  // 单栏宽度下列表与详情是两个视图，切换时回到顶部；两栏宽度下位置不动。
  // 探测不到视口时直接跳过——这只是回顶，缺了不影响任何功能。
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (typeof window.matchMedia !== 'function') return
    if (!window.matchMedia('(max-width: 1023px)').matches) return
    window.scrollTo({ top: 0 })
  }, [selectedId])

  return (
    <div className="space-y-4">
      <div className={cn('space-y-1', hasSelection && 'max-lg:hidden')}>
        <h1 className="text-2xl font-semibold tracking-tight">问题处理</h1>
        <p className="text-sm text-muted-foreground">
          查看和跟进你提交的、需要你处理的、以及你关注的问题。要提交新问题，请在对应的条目或资源页面使用「报告问题」入口。
        </p>
      </div>

      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-2',
          hasSelection && 'max-lg:hidden'
        )}
      >
        <Tabs value={tab} onValueChange={handleTabChange}>
          <TabsList className="h-9">
            {CASE_TABS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {CASE_TAB_LABELS[value]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void fetchList()}
        >
          <RefreshCw
            className={cn('size-4', loading && 'animate-spin')}
            aria-hidden
          />
          刷新
        </Button>
      </div>

      {hasSelection ? (
        <div className="lg:hidden">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearSelection}
          >
            <ArrowLeft className="size-4" aria-hidden />
            返回列表
          </Button>
        </div>
      ) : null}

      {/*
        单栏宽度下列表与详情互斥呈现（用 CSS 切换，避免 SSR 后再按视口翻转造成闪动）；
        lg 起并排，左列表右详情。
      */}
      <div className="grid gap-4 lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)] lg:items-start">
        <div className={cn('min-w-0', hasSelection && 'max-lg:hidden')}>
          <IssueCaseList
            rows={rows}
            tab={tab}
            statusKey={statusKey}
            statusCounts={list ? list.statusCounts : null}
            total={list ? list.total : null}
            page={page}
            limit={list ? list.limit : PAGE_SIZE}
            loading={loading}
            error={error}
            selectedId={selectedId}
            hrefFor={(caseId) => buildHref({ selection: caseId })}
            onStatusChange={handleStatusChange}
            onRetry={() => void fetchList()}
            onPageChange={handlePageChange}
          />
        </div>

        <div className={cn('min-w-0', !hasSelection && 'max-lg:hidden')}>
          {selectedId === null ? (
            <Card className="py-16">
              <CardContent className="flex flex-col items-center gap-2 text-center">
                <MessagesSquare
                  className="size-7 text-muted-foreground"
                  aria-hidden
                />
                <p className="text-sm text-muted-foreground">
                  从左侧列表选择一个问题，查看处理进度
                </p>
              </CardContent>
            </Card>
          ) : (
            <IssueCaseDetail
              key={selectedId}
              caseId={selectedId}
              onChanged={() => void fetchList()}
            />
          )}
        </div>
      </div>
    </div>
  )
}
