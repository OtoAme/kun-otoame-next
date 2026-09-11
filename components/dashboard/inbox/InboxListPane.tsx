'use client'

import {
  FileText,
  Flag,
  MessageSquare,
  Package,
  type LucideIcon
} from 'lucide-react'

import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import { Skeleton } from '~/components/dashboard/ui/skeleton'
import { INBOX_KIND_LABELS } from '~/constants/dashboard'
import type { UseInboxReturn } from '~/hooks/dashboard/useInbox'
import { cn } from '~/lib/dashboard/utils'
import type { InboxKind } from '~/types/api/inbox'

const KIND_ICONS: Record<InboxKind, LucideIcon> = {
  submission: FileText,
  'resource-apply': Package,
  feedback: MessageSquare,
  report: Flag
}

function formatWaiting(seconds: number): string {
  if (seconds < 60) return '等待不足 1 分钟'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `等待 ${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `等待 ${hours} 小时`
  return `等待 ${Math.floor(hours / 24)} 天`
}

export function InboxListPane({ inbox }: { inbox: UseInboxReturn }) {
  const {
    kinds,
    search,
    items,
    totals,
    truncated,
    listLoading,
    listError,
    selectedKey,
    selectItem,
    retryList
  } = inbox

  const selectedTotal = totals
    ? kinds.reduce((sum, kind) => sum + (totals[kind] ?? 0), 0)
    : null
  const truncatedKinds = kinds.filter((kind) => truncated?.[kind])

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="space-y-1 border-b px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">待办列表</h2>
          <span className="shrink-0 text-xs text-muted-foreground">
            {selectedTotal === null
              ? `已显示 ${items.length} 条`
              : `已显示 ${items.length} / ${selectedTotal} 条`}
            {listLoading && items.length > 0 ? '，更新中…' : ''}
          </span>
        </div>
        {truncatedKinds.map((kind) => (
          <p key={kind} className="text-xs text-muted-foreground">
            {INBOX_KIND_LABELS[kind]}：该来源还有更多，先处理这些
          </p>
        ))}
      </div>

      {listError && items.length > 0 ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 border-b px-3 py-2"
        >
          <span className="min-w-0 break-words text-xs text-destructive">
            加载失败：{listError}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={retryList}>
            重试
          </Button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={listLoading}>
        {listLoading && items.length === 0 ? (
          <div role="status" aria-label="正在加载待办事项">
            <ul className="space-y-2 p-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <li key={index}>
                  <Skeleton className="h-16 w-full" />
                </li>
              ))}
            </ul>
          </div>
        ) : items.length === 0 && listError ? (
          <div
            role="alert"
            className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
          >
            <p className="text-sm text-muted-foreground">
              加载失败：{listError}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={retryList}
            >
              重试
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              {search.trim()
                ? '没有找到匹配的待办事项'
                : '当前没有待处理的事项'}
            </p>
          </div>
        ) : (
          <ul aria-label="待办事项列表" className="divide-y">
            {items.map((item) => {
              const Icon = KIND_ICONS[item.kind]
              const selected = item.key === selectedKey
              return (
                <li key={item.key}>
                  <Button
                    type="button"
                    variant="ghost"
                    data-inbox-row-key={item.key}
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => selectItem(item)}
                    className={cn(
                      'h-auto w-full min-w-0 items-start justify-start gap-2 whitespace-normal rounded-none px-3 py-2 text-left font-normal',
                      selected && 'bg-accent'
                    )}
                  >
                    <Icon
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {item.title}
                        </span>
                        {item.readOnly ? (
                          <Badge variant="outline" className="shrink-0">
                            旧，去旧后台处理
                          </Badge>
                        ) : null}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.subtitle}
                      </span>
                      <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        <span className="shrink-0">
                          {formatWaiting(item.waitingSeconds)}
                        </span>
                        <Badge variant="secondary">
                          {INBOX_KIND_LABELS[item.kind]}
                        </Badge>
                        {item.badges.map((badge, index) => (
                          <Badge
                            key={`${item.key}-badge-${index}`}
                            variant="outline"
                          >
                            {badge}
                          </Badge>
                        ))}
                      </span>
                    </span>
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
