'use client'

import { DashboardPagination } from '~/components/dashboard/page/DashboardPagination'
import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import { Skeleton } from '~/components/dashboard/ui/skeleton'
import { cn } from '~/lib/dashboard/utils'
import type { MergeTab } from '~/types/api/officialMirror'
import type { MergeListRow } from '../contract'
import { cardName, rowBadge, rowMeta, showTime } from './mergeDisplay'

const BADGE_VARIANT = {
  recommended: 'default',
  high: 'default',
  manual: 'secondary',
  none: 'outline'
} as const

function MergeQueueRow({
  row,
  tab,
  selected,
  onSelect
}: {
  row: MergeListRow
  tab: MergeTab
  selected: boolean
  onSelect: (id: number) => void
}) {
  const badge = tab === 'pending' ? rowBadge(row) : null
  return (
    <Button
      type="button"
      variant="ghost"
      data-merge-row={row.id}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(row.id)}
      className={cn(
        'h-auto w-full min-w-0 flex-col items-start justify-start gap-1 rounded-none px-3 py-2 text-left font-normal whitespace-normal',
        selected && 'bg-accent shadow-[inset_3px_0_0_var(--primary)]'
      )}
    >
      <span className="w-full min-w-0 text-sm font-medium break-words">
        {cardName(row.userResource.name)}
      </span>
      <span className="w-full min-w-0 text-xs break-words text-muted-foreground">
        {rowMeta(row)}
      </span>
      <span className="flex w-full min-w-0 flex-wrap items-center gap-1">
        {badge ? (
          <Badge variant={BADGE_VARIANT[badge.tone]}>{badge.text}</Badge>
        ) : (
          <span className="text-xs break-words text-muted-foreground">
            {row.handledBy?.name || '—'} · {showTime(row.handledAt)}
          </span>
        )}
        {row.hasStaffBackup ? (
          <Badge variant="outline">已有站方备份</Badge>
        ) : null}
      </span>
    </Button>
  )
}

export function MergeQueueList({
  rows,
  tab,
  total,
  page,
  limit,
  loading,
  error,
  filtered,
  selectedId,
  onSelect,
  onPageChange,
  onRetry
}: {
  rows: MergeListRow[]
  tab: MergeTab
  /** Null while the current query has no response. */
  total: number | null
  page: number
  limit: number
  loading: boolean
  error: string | null
  /** A search or filter is active; changes the empty text. */
  filtered: boolean
  selectedId: number | null
  onSelect: (id: number) => void
  onPageChange: (page: number) => void
  onRetry: () => void
}) {
  const totalPages = total === null ? 1 : Math.max(1, Math.ceil(total / limit))
  return (
    <div
      data-merge-queue-list
      className="flex h-full min-h-0 min-w-0 flex-col max-md:h-auto"
    >
      <div
        className="min-h-0 flex-1 overflow-y-auto max-md:flex-none max-md:overflow-visible"
        aria-busy={loading}
      >
        {loading && rows.length === 0 ? (
          <div role="status" aria-label="正在加载用户资源列表">
            <ul className="divide-y">
              {Array.from({ length: 6 }).map((_, index) => (
                <li key={index} className="space-y-2 px-3 py-3">
                  <Skeleton className="h-4 w-full animate-none" />
                  <Skeleton className="h-3 w-2/3 animate-none" />
                </li>
              ))}
            </ul>
          </div>
        ) : error !== null && rows.length === 0 ? (
          <div
            role="alert"
            className="flex flex-col items-center gap-3 p-6 text-center"
          >
            <p className="text-sm break-words text-muted-foreground">
              加载失败：{error}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              重试
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {filtered ? '没有匹配的用户资源，换个条件再试。' : '没有用户资源。'}
          </p>
        ) : (
          <ul aria-label="用户资源列表" className="divide-y">
            {rows.map((row) => (
              <li key={row.id}>
                <MergeQueueRow
                  row={row}
                  tab={tab}
                  selected={row.id === selectedId}
                  onSelect={onSelect}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      {total === null ? (
        <div className="flex shrink-0 items-center border-t px-3 py-2 text-xs text-muted-foreground">
          —
        </div>
      ) : (
        <DashboardPagination
          page={page}
          totalPages={totalPages}
          total={total}
          unit="张"
          disabled={loading}
          onPageChange={onPageChange}
          className="text-xs"
        />
      )}
    </div>
  )
}
