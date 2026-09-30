'use client'

import { ArrowDown, ArrowUp } from 'lucide-react'

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
import type { CaseSortField, CaseSortOrder } from '~/constants/case'
import { cn } from '~/lib/dashboard/utils'
import type { AdminCaseListItem } from '~/types/api/case'

import { CASE_STATUS_BADGE_VARIANTS } from './caseBadges'

/**
 * Column template of the wide layout. The four trailing tracks cap at their
 * content width, so every bit of compression lands on the title track: below
 * the threshold the row must stop being a table rather than keep shrinking
 * its own identity column.
 */
const TABLE_COLUMNS =
  '@[52rem]:grid-cols-[minmax(0,1fr)_minmax(0,6.5rem)_minmax(0,7rem)_minmax(0,7rem)_minmax(0,7.5rem)]'

const tableColumns = (
  showOwner: boolean
): { label: string; sort: CaseSortField }[] => [
  { label: '编号与目标', sort: 'id' },
  { label: '状态', sort: 'status' },
  { label: '类型', sort: 'kind' },
  showOwner
    ? { label: '发布者', sort: 'owner' }
    : { label: '提交人', sort: 'reporter' },
  { label: '时间', sort: 'time' }
]

const ORDER_LABELS: Record<CaseSortOrder, string> = {
  asc: '升序',
  desc: '降序'
}

/** Shown only below the threshold, where the meta line is one flow. */
const SEP = '@[52rem]:hidden'

/** Waiting time is meaningless once a case is closed; the badge says enough. */
const waitingText = (row: AdminCaseListItem, nowMs: number): string => {
  if (row.status === 'resolved' || row.status === 'rejected') return ''
  const entered = Date.parse(row.statusChangedAt)
  if (Number.isNaN(entered) || Number.isNaN(nowMs)) return ''
  return `等待 ${formatCaseDuration(nowMs - entered)}`
}

export interface CaseQueueRowProps {
  row: AdminCaseListItem
  selected: boolean
  nowMs: number
  onSelect: (row: AdminCaseListItem) => void
  /**
   * Opt into the wide column layout, which then depends on the width of the
   * nearest `@container` rather than on the viewport. Off means cards only.
   */
  tabular?: boolean
  /** Name the publisher who owns the case instead of the reporter (D22). */
  showOwner?: boolean
}

/**
 * One queue row, in a single DOM that CSS lays out two ways.
 *
 * Stacked (narrow container, and everywhere when `tabular` is off):
 *
 *     #11  资源X（条目A）                    [等待处理方]
 *     请补充截图
 *     资源与描述不符 · 举报人 · 2 人报告      等待 3 天 · 09/10 08:00
 *
 * Aligned columns (container ≥ 52rem): the meta wrapper becomes
 * `display: contents`, promoting its three cells to grid items so they line
 * up with the header, without a second copy of the row in the DOM.
 */
export function CaseQueueRow({
  row,
  selected,
  nowMs,
  onSelect,
  tabular = false,
  showOwner = false
}: CaseQueueRowProps) {
  const resolutionLabel = caseResolutionLabel(row.resolution)
  // 重开或复核中的事项还没有结论，列表里的旧结论标为「上次」（审阅第 6 条）
  const resolutionText =
    resolutionLabel &&
    row.status !== 'resolved' &&
    row.status !== 'rejected'
      ? `上次：${resolutionLabel}`
      : resolutionLabel
  const waiting = waitingText(row, nowMs)
  const reportCount =
    row.subscriberCount !== null ? `${row.subscriberCount} 人报告` : ''
  const personName = showOwner
    ? (row.owner?.name ?? '发布者')
    : (row.reporter?.name ?? '报告者')

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
      <span
        className={cn(
          'grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1',
          tabular && cn(TABLE_COLUMNS, '@[52rem]:items-start @[52rem]:gap-y-0')
        )}
      >
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

        <span
          className={cn(
            'min-w-0 justify-self-end text-right',
            tabular && '@[52rem]:justify-self-start @[52rem]:text-left'
          )}
        >
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
          {row.reopenedCount > 0 ? (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              重开 {row.reopenedCount} 次
            </span>
          ) : null}
        </span>

        <span
          className={cn(
            'col-span-2 flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground',
            tabular && '@[52rem]:contents'
          )}
        >
          <span className="min-w-0 truncate">{caseKindLabel(row.kind)}</span>
          <span aria-hidden className={cn(tabular && SEP)}>
            ·
          </span>
          <span
            className={cn(
              'flex min-w-0 items-center gap-x-2',
              tabular && '@[52rem]:block'
            )}
          >
            <span className="truncate">{personName}</span>
            {reportCount ? (
              <>
                <span aria-hidden className={cn(tabular && SEP)}>
                  ·
                </span>
                <span
                  className={cn(
                    'truncate',
                    tabular && '@[52rem]:mt-0.5 @[52rem]:block'
                  )}
                >
                  {reportCount}
                </span>
              </>
            ) : null}
          </span>
          <span
            className={cn(
              'ml-auto flex shrink-0 items-center gap-x-2',
              tabular && '@[52rem]:ml-0 @[52rem]:block @[52rem]:min-w-0'
            )}
          >
            {waiting ? (
              <>
                <span className={cn(tabular && '@[52rem]:block')}>
                  {waiting}
                </span>
                <span aria-hidden className={cn(tabular && SEP)}>
                  ·
                </span>
              </>
            ) : null}
            {/* The clock the waiting text and the time column's sort read. */}
            <span
              className={cn(
                'tabular-nums',
                tabular && '@[52rem]:mt-0.5 @[52rem]:block @[52rem]:truncate'
              )}
            >
              {formatChinaDateTime(row.statusChangedAt)}
            </span>
          </span>
        </span>
      </span>
    </Button>
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
  /** Publisher view: rows name the owning publisher (D22). */
  showOwner?: boolean
  sort: CaseSortField
  order: CaseSortOrder
  onSelect: (row: AdminCaseListItem) => void
  /** A column head was clicked; the caller decides the direction. */
  onSortChange: (sort: CaseSortField) => void
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
  showOwner = false,
  sort,
  order,
  onSelect,
  onSortChange,
  onPageChange,
  onRetry
}: CaseQueueListProps) {
  const totalPages = total === null ? 1 : Math.max(1, Math.ceil(total / limit))
  const nowMs = now ? Date.parse(now) : Number.NaN
  const resolvedEmptyText = searchActive ? '没有找到匹配的事项' : emptyText
  const SortArrow = order === 'asc' ? ArrowUp : ArrowDown

  // Rows read their layout off this container, not off the viewport: the pane
  // is narrowed by the detail, by the secondary nav appearing at lg, and by
  // the user dragging the divider — none of which the viewport width knows.
  //
  // Same responsive contract as the unified inbox list pane: on mobile the
  // pane is content-driven and joins the shared page flow; from md up it
  // keeps its own internal scroller.
  return (
    <div
      data-case-queue-list
      className="@container flex h-full min-h-0 min-w-0 flex-col max-md:h-auto"
    >
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

      {/*
        Column heads sort the list. They stay mounted while a new order
        loads, so the head just clicked keeps keyboard focus. Below the
        threshold they are hidden and the cards keep the order in the URL.
      */}
      <div
        role="group"
        aria-label="列表排序"
        data-case-table-head
        className={cn(
          'hidden gap-x-3 border-b bg-muted/40 px-3 py-0.5 text-xs text-muted-foreground @[52rem]:grid',
          TABLE_COLUMNS
        )}
      >
        {tableColumns(showOwner).map((column) => {
          const active = column.sort === sort
          return (
            <Button
              key={column.sort}
              type="button"
              variant="ghost"
              size="xs"
              data-case-sort={column.sort}
              aria-label={
                active
                  ? `按${column.label}排序，当前${ORDER_LABELS[order]}`
                  : `按${column.label}排序`
              }
              onClick={() => onSortChange(column.sort)}
              className={cn(
                '-ml-1.5 max-w-full min-w-0 justify-self-start px-1.5 font-normal',
                active && 'text-foreground'
              )}
            >
              <span className="truncate">{column.label}</span>
              {active ? <SortArrow aria-hidden /> : null}
            </Button>
          )
        })}
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto max-md:flex-none max-md:overflow-visible"
        aria-busy={loading}
      >
        {loading && rows.length === 0 ? (
          <div role="status" aria-label="正在加载事项列表">
            <ul className="divide-y">
              {Array.from({ length: 8 }).map((_, index) => (
                <li key={index} className="space-y-2 px-3 py-3">
                  <Skeleton className="h-4 w-full animate-none" />
                  <Skeleton className="h-3 w-2/3 animate-none" />
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
                <CaseQueueRow
                  row={row}
                  selected={row.id === selectedId}
                  nowMs={nowMs}
                  onSelect={onSelect}
                  tabular
                  showOwner={showOwner}
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
