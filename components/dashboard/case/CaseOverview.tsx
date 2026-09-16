'use client'

import type { ComponentType } from 'react'
import {
  ArrowRight,
  CircleCheck,
  Inbox,
  Timer,
  UserRoundCheck
} from 'lucide-react'

import { Button } from '~/components/dashboard/ui/button'
import { Card, CardContent } from '~/components/dashboard/ui/card'
import { Skeleton } from '~/components/dashboard/ui/skeleton'
import { formatCaseDuration } from '~/components/case/caseDisplay'
import type { InboxCounts } from '~/types/api/inbox'
import type {
  AdminCaseListItem,
  AdminCaseListResponse,
  CaseStatusCounts
} from '~/types/api/case'

import { CaseQueueCardRow } from './CaseQueueList'
import {
  caseViewCount,
  PENDING_CASE_VIEW,
  UNRESOLVED_CASE_VIEW
} from './caseCenterViews'

interface CaseOverviewProps {
  /** Dashboard shell counts; null until the shell's first response. */
  counts: InboxCounts | null
  countsLoading: boolean
  statusCounts: CaseStatusCounts | null
  /** Oldest-first page of the default queue, reused as the work list. */
  rows: AdminCaseListItem[]
  list: AdminCaseListResponse | null
  loading: boolean
  error: string
  onRetry: () => void
  onSelectCase: (row: AdminCaseListItem) => void
  onOpenQueue: () => void
}

interface StatCard {
  /** Stable hook for tests; also keeps the card list self-describing. */
  key: string
  label: string
  value: string
  hint: string
  icon: ComponentType<{ className?: string }>
}

/**
 * Case-center overview. Every figure comes from data the center already
 * fetches — the shell's pending counts and the default queue's response —
 * so the page adds no aggregation endpoint of its own. Throughput and
 * satisfaction dashboards belong to module 09 and are deliberately absent.
 */
export function CaseOverview({
  counts,
  countsLoading,
  statusCounts,
  rows,
  list,
  loading,
  error,
  onRetry,
  onSelectCase,
  onOpenQueue
}: CaseOverviewProps) {
  const countValue = (value: number | null): string => {
    if (value !== null) return String(value)
    return countsLoading ? '…' : '-'
  }

  const unresolved = caseViewCount(statusCounts, UNRESOLVED_CASE_VIEW)
  const pending = caseViewCount(statusCounts, PENDING_CASE_VIEW)
  const queueValue = (value: number | null): string => {
    if (value !== null) return String(value)
    return loading ? '…' : '-'
  }
  const nowMs = list ? Date.parse(list.now) : Number.NaN
  // Rows arrive oldest-first, so the head of page 1 is the whole queue's
  // oldest entry — the one module 03 §7.4 requires to stay visible.
  const oldestWaiting = (() => {
    if (rows.length === 0 || Number.isNaN(nowMs)) return null
    const entered = Date.parse(rows[0].statusChangedAt)
    if (Number.isNaN(entered)) return null
    return formatCaseDuration(nowMs - entered)
  })()

  const cards: StatCard[] = [
    {
      key: 'unresolved',
      label: '未结事项',
      value: queueValue(unresolved),
      hint: '站方队列全部未结，最老优先',
      icon: Inbox
    },
    {
      key: 'pending',
      label: '待处理',
      value: queueValue(pending),
      hint: '其中轮到站方动手的那批',
      icon: UserRoundCheck
    },
    {
      key: 'oldest',
      label: '最久等待',
      value: oldestWaiting ?? '—',
      hint: '未结队列中最老一条',
      icon: Timer
    },
    {
      key: 'today',
      label: '今日已处理',
      value: countValue(counts ? counts.todayProcessed : null),
      hint: '全部来源',
      icon: CircleCheck
    }
  ]

  return (
    <div className="space-y-6 p-4">
      <section aria-label="事项概览" className="space-y-3">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {cards.map((card) => (
            <Card
              key={card.key}
              data-case-stat={card.key}
              className="gap-0 py-3 shadow-none"
            >
              <CardContent className="flex min-w-0 items-center gap-3 px-4">
                <card.icon
                  className="size-5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-xs text-muted-foreground">
                      {card.label}
                    </span>
                    <span
                      data-case-stat-value
                      className="ml-auto text-2xl font-semibold tabular-nums"
                    >
                      {card.value}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {card.hint}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section aria-label="最久等待的事项" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">最久等待的事项</h2>
          <Button type="button" variant="ghost" size="sm" onClick={onOpenQueue}>
            查看未结队列
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        </div>

        {error ? (
          <div
            role="alert"
            className="flex flex-col items-center gap-3 rounded-md border border-dashed p-6 text-center"
          >
            <p className="text-sm text-muted-foreground">加载失败：{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              重试
            </Button>
          </div>
        ) : loading && rows.length === 0 ? (
          <div
            role="status"
            aria-label="正在加载事项列表"
            className="divide-y rounded-md border"
          >
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="space-y-2 px-3 py-3">
                <Skeleton className="h-4 w-full animate-none" />
                <Skeleton className="h-3 w-2/3 animate-none" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            站方队列当前没有未结事项
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {rows.map((row) => (
              <li key={row.id}>
                <CaseQueueCardRow
                  row={row}
                  selected={false}
                  nowMs={nowMs}
                  onSelect={onSelectCase}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
