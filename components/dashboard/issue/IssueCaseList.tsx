'use client'

import Link from 'next/link'
import { ChevronRight, Inbox, TriangleAlert } from 'lucide-react'

import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import { Card } from '~/components/dashboard/ui/card'
import { Skeleton } from '~/components/dashboard/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '~/components/dashboard/ui/tabs'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import {
  caseKindLabel,
  caseResolutionLabel,
  caseTargetText,
  caseViewerStatusText
} from '~/components/case/caseDisplay'
import { cn } from '~/lib/dashboard/utils'
import type {
  CaseListItem,
  CaseStatus,
  CaseStatusCounts,
  CaseTab
} from '~/types/api/case'

import {
  STATUS_FILTERS,
  statusFilterCount,
  statusFilterLabel,
  type StatusFilterKey
} from './issueFilters'

const STATUS_BADGE_VARIANTS: Record<
  CaseStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  open: 'default',
  waiting_owner: 'default',
  waiting_reporter: 'secondary',
  resolved: 'outline',
  rejected: 'destructive',
  merged: 'outline'
}

const EMPTY_TEXT: Record<CaseTab, string> = {
  reported: '暂无问题',
  owned: '没有待你处理的问题',
  subscribed: '你还没有关注任何问题'
}

export interface IssueCaseListProps {
  rows: CaseListItem[]
  tab: CaseTab
  statusKey: StatusFilterKey
  /** Null until a response for the standing query exists. */
  statusCounts: CaseStatusCounts | null
  /** Total of the current filter; null while no matching response exists. */
  total: number | null
  page: number
  limit: number
  loading: boolean
  error: string
  selectedId: number | null
  hrefFor: (caseId: number) => string
  onStatusChange: (key: StatusFilterKey) => void
  onRetry: () => void
  onPageChange: (page: number) => void
}

export function IssueCaseList({
  rows,
  tab,
  statusKey,
  statusCounts,
  total,
  page,
  limit,
  loading,
  error,
  selectedId,
  hrefFor,
  onStatusChange,
  onRetry,
  onPageChange
}: IssueCaseListProps) {
  const totalPages = total === null ? 1 : Math.max(1, Math.ceil(total / limit))
  const emptyText = statusKey === 'all' ? EMPTY_TEXT[tab] : '这一类下暂无问题'

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="border-b p-3">
        <Tabs
          value={statusKey}
          onValueChange={(value) => onStatusChange(value as StatusFilterKey)}
        >
          {/*
            variant="line" 的选中下划线画在 after:bottom-[-5px]，落在 TabsList
            盒子之外。横向滚动因此放在外层并留出下边距：窄屏（≈390px）下页签
            横向滚动而不是换行，下划线也不会被滚动容器裁掉。
          */}
          <div className="-mb-1.5 overflow-x-auto pb-1.5">
            <TabsList variant="line" className="h-8 w-max justify-start">
              {STATUS_FILTERS.map((filter) => (
                <TabsTrigger
                  key={filter.key}
                  value={filter.key}
                  className="shrink-0 text-xs"
                >
                  {statusFilterLabel(filter.key, tab)}
                  {statusCounts ? (
                    <span className="tabular-nums text-muted-foreground">
                      {statusFilterCount(filter.key, statusCounts)}
                    </span>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>
      </div>

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

      <div
        className="lg:max-h-[calc(100dvh-16rem)] lg:overflow-y-auto"
        aria-busy={loading}
      >
        {loading && rows.length === 0 ? (
          <div role="status" aria-label="正在加载问题列表">
            <ul className="space-y-3 p-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <li key={index} className="space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </li>
              ))}
            </ul>
          </div>
        ) : rows.length === 0 && error ? (
          <div
            role="alert"
            className="flex flex-col items-center gap-2 px-6 py-12 text-center"
          >
            <TriangleAlert className="size-7 text-destructive" aria-hidden />
            <p className="text-sm font-medium">加载失败，请重试</p>
            <p className="text-xs text-muted-foreground">{error}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1"
              onClick={onRetry}
            >
              重新加载
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <Inbox className="size-7 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">{emptyText}</p>
            <p className="text-xs text-muted-foreground">
              在条目或资源页面用「报告问题」提交后，可以在这里跟进处理进度。
            </p>
          </div>
        ) : (
          <ul aria-label="问题列表" className="divide-y">
            {rows.map((row) => {
              const selected = row.id === selectedId
              const resolutionText = caseResolutionLabel(row.resolution)
              return (
                <li key={row.id}>
                  <Link
                    href={hrefFor(row.id)}
                    scroll={false}
                    aria-current={selected ? 'true' : undefined}
                    className={cn(
                      'flex items-center gap-2 px-3 py-3 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
                      selected &&
                        'bg-accent/60 border-l-2 border-l-primary pl-[calc(0.75rem-2px)]'
                    )}
                  >
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-xs text-muted-foreground tabular-nums">
                          #{row.id}
                        </span>
                        <Badge
                          variant={STATUS_BADGE_VARIANTS[row.status]}
                          className="ml-auto shrink-0"
                        >
                          {caseViewerStatusText(row, tab)}
                        </Badge>
                      </span>
                      <span className="block truncate text-sm font-medium">
                        {caseTargetText(row)}
                      </span>
                      <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span>{caseKindLabel(row.kind)}</span>
                        <span aria-hidden>·</span>
                        <span>提交于 {formatChinaDateTime(row.created)}</span>
                        {row.subscriberCount !== null ? (
                          <span>{row.subscriberCount} 人报告</span>
                        ) : null}
                        {resolutionText ? (
                          <span>结论：{resolutionText}</span>
                        ) : null}
                      </span>
                      {row.latestMessage?.body ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {row.latestMessage.body}
                        </span>
                      ) : null}
                    </span>
                    <ChevronRight
                      className="size-4 shrink-0 text-muted-foreground lg:hidden"
                      aria-hidden
                    />
                  </Link>
                </li>
              )
            })}
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
            第 {page} / {totalPages} 页，共 {total} 条
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
    </Card>
  )
}
