'use client'

import type { ReactNode } from 'react'

import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import { Skeleton } from '~/components/dashboard/ui/skeleton'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import {
  caseKindLabel,
  caseResolutionLabel,
  caseStatusLabel,
  caseTargetText,
  formatCaseDuration
} from '~/components/case/caseDisplay'
import { cn } from '~/lib/dashboard/utils'
import type { AdminCaseListItem } from '~/types/api/case'

import { CASE_STATUS_BADGE_VARIANTS } from './caseBadges'

/**
 * `table` aligns every row on the same tracks and is only used when the list
 * owns the full width of the case center; `card` stacks the same fields and
 * is used in the narrow rail next to an open detail, and on mobile.
 */
export type CaseQueueLayout = 'table' | 'card'

// Every track may shrink to zero so a cramped workbench wraps text instead of
// scrolling sideways. The column header reuses the same template.
const TABLE_COLUMNS =
  'grid-cols-[minmax(0,1fr)_minmax(0,6.5rem)_minmax(0,7rem)_minmax(0,7rem)_minmax(0,7.5rem)]'

const TABLE_HEADINGS = ['编号与目标', '状态', '类型', '提交人', '时间']

/** Waiting time is meaningless once a case is closed; the badge says enough. */
const waitingText = (row: AdminCaseListItem, nowMs: number): string => {
  if (row.status === 'resolved' || row.status === 'rejected') return ''
  const entered = Date.parse(row.statusChangedAt)
  if (Number.isNaN(entered) || Number.isNaN(nowMs)) return ''
  return `等待 ${formatCaseDuration(nowMs - entered)}`
}

const reporterName = (row: AdminCaseListItem): string =>
  row.reporter?.name ?? '报告者'

const reportCountText = (row: AdminCaseListItem): string =>
  row.subscriberCount !== null ? `${row.subscriberCount} 人报告` : ''

export interface CaseRowProps {
  row: AdminCaseListItem
  selected: boolean
  nowMs: number
  onSelect: (row: AdminCaseListItem) => void
}

function RowShell({
  row,
  selected,
  onSelect,
  children
}: CaseRowProps & { children: ReactNode }) {
  return (
    <Button
      type="button"
      variant="ghost"
      data-case-row-id={row.id}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(row)}
      className={cn(
        'h-auto w-full min-w-0 items-start justify-start whitespace-normal rounded-none px-3 py-2 text-left font-normal',
        selected && 'bg-accent'
      )}
    >
      {children}
    </Button>
  )
}

function CaseTableRow(props: CaseRowProps) {
  const { row, nowMs } = props
  const resolutionText = caseResolutionLabel(row.resolution)
  const waiting = waitingText(row, nowMs)
  const reportCount = reportCountText(row)
  return (
    <RowShell {...props}>
      <span className={cn('grid min-w-0 flex-1 gap-x-3', TABLE_COLUMNS)}>
        <span className="min-w-0">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              #{row.id}
            </span>
            <span className="truncate text-sm font-medium">
              {caseTargetText(row)}
            </span>
          </span>
          {row.latestMessage?.body ? (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {row.latestMessage.body}
            </span>
          ) : null}
        </span>
        <span className="min-w-0">
          <Badge
            variant={CASE_STATUS_BADGE_VARIANTS[row.status]}
            className="max-w-full"
          >
            <span className="truncate">{caseStatusLabel(row.status)}</span>
          </Badge>
          {resolutionText ? (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {resolutionText}
            </span>
          ) : null}
        </span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {caseKindLabel(row.kind)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs text-muted-foreground">
            {reporterName(row)}
          </span>
          {reportCount ? (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {reportCount}
            </span>
          ) : null}
        </span>
        <span className="min-w-0 text-xs text-muted-foreground">
          {waiting ? <span className="block truncate">{waiting}</span> : null}
          <span className="mt-0.5 block truncate tabular-nums">
            {formatChinaDateTime(row.updated)}
          </span>
        </span>
      </span>
    </RowShell>
  )
}

export function CaseQueueCardRow(props: CaseRowProps) {
  const { row, nowMs } = props
  const resolutionText = caseResolutionLabel(row.resolution)
  const waiting = waitingText(row, nowMs)
  const reportCount = reportCountText(row)
  return (
    <RowShell {...props}>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            #{row.id}
          </span>
          <span className="truncate text-sm font-medium">
            {caseTargetText(row)}
          </span>
          <Badge
            variant={CASE_STATUS_BADGE_VARIANTS[row.status]}
            className="ml-auto shrink-0"
          >
            {caseStatusLabel(row.status)}
          </Badge>
        </span>
        {row.latestMessage?.body ? (
          <span className="block truncate text-xs text-muted-foreground">
            {row.latestMessage.body}
          </span>
        ) : null}
        <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>{caseKindLabel(row.kind)}</span>
          <span aria-hidden>·</span>
          <span className="truncate">{reporterName(row)}</span>
          {reportCount ? (
            <>
              <span aria-hidden>·</span>
              <span>{reportCount}</span>
            </>
          ) : null}
          {waiting ? (
            <>
              <span aria-hidden>·</span>
              <span>{waiting}</span>
            </>
          ) : null}
          {resolutionText ? (
            <>
              <span aria-hidden>·</span>
              <span>{resolutionText}</span>
            </>
          ) : null}
          <span className="ml-auto shrink-0 tabular-nums">
            {formatChinaDateTime(row.updated)}
          </span>
        </span>
      </span>
    </RowShell>
  )
}

export interface CaseQueueListProps {
  rows: AdminCaseListItem[]
  /** Total of the current filter; null while no matching response exists. */
  total: number | null
  page: number
  limit: number
  /** Server clock from the list response, for waiting-time display. */
  now: string | null
  loading: boolean
  error: string
  selectedId: number | null
  /** Copy for an empty queue; the active view supplies it. */
  emptyText: string
  searchActive: boolean
  layout: CaseQueueLayout
  onSelect: (row: AdminCaseListItem) => void
  onPageChange: (page: number) => void
  onRetry: () => void
}

export function CaseQueueList({
  rows,
  total,
  page,
  limit,
  now,
  loading,
  error,
  selectedId,
  emptyText,
  searchActive,
  layout,
  onSelect,
  onPageChange,
  onRetry
}: CaseQueueListProps) {
  const totalPages = total === null ? 1 : Math.max(1, Math.ceil(total / limit))
  const nowMs = now ? Date.parse(now) : Number.NaN
  const resolvedEmptyText = searchActive ? '没有找到匹配的事项' : emptyText
  const Row = layout === 'table' ? CaseTableRow : CaseQueueCardRow

  // Same responsive contract as the unified inbox list pane: on mobile the
  // pane is content-driven and joins the shared page flow; from md up it
  // keeps its own internal scroller.
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col max-md:h-auto">
      {error && rows.length > 0 ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 border-b px-3 py-2"
        >
          <span className="min-w-0 break-words text-xs text-destructive">
            加载失败：{error}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            重试
          </Button>
        </div>
      ) : null}

      {layout === 'table' && rows.length > 0 ? (
        <div
          aria-hidden
          className={cn(
            'grid gap-x-3 border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground',
            TABLE_COLUMNS
          )}
        >
          {TABLE_HEADINGS.map((heading) => (
            <span key={heading} className="min-w-0 truncate">
              {heading}
            </span>
          ))}
        </div>
      ) : null}

      <div
        className="min-h-0 flex-1 overflow-y-auto max-md:flex-none max-md:overflow-visible"
        aria-busy={loading}
      >
        {loading && rows.length === 0 ? (
          <div role="status" aria-label="正在加载事项列表">
            <ul className="divide-y">
              {Array.from({ length: 8 }).map((_, index) => (
                <li key={index} className="px-3 py-3">
                  <Skeleton
                    className={cn(
                      'h-4 w-full animate-none',
                      layout === 'card' && 'mb-2'
                    )}
                  />
                  {layout === 'card' ? (
                    <Skeleton className="h-3 w-2/3 animate-none" />
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : rows.length === 0 && error ? (
          <div
            role="alert"
            className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
          >
            <p className="text-sm text-muted-foreground">加载失败：{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              重试
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-sm text-muted-foreground">{resolvedEmptyText}</p>
          </div>
        ) : (
          <ul aria-label="事项列表" className="divide-y">
            {rows.map((row) => (
              <li key={row.id}>
                <Row
                  row={row}
                  selected={row.id === selectedId}
                  nowMs={nowMs}
                  onSelect={onSelect}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {total !== null && total > limit ? (
        <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            上一页
          </Button>
          <span className="text-xs text-muted-foreground">
            第 {page} / {totalPages} 页
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            下一页
          </Button>
        </div>
      ) : null}
    </div>
  )
}
