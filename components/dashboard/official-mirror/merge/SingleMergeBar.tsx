'use client'

import { X } from 'lucide-react'
import { Button } from '~/components/dashboard/ui/button'
import type { CacheRefreshRequest } from '../cacheRefresh'

export type SettledMerge = {
  userResourceId: number
  staffResourceId: number
  userName: string
  staffName: string
  cacheRefreshed: boolean
  retry: CacheRefreshRequest | null
  pending: boolean
  error: string
}

/** Result of the last single merge, kept after the row leaves the list. */
export function SingleMergeBar({
  result,
  onRetry,
  onClose
}: {
  result: SettledMerge
  onRetry: () => void
  onClose: () => void
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2 text-sm">
      <p role="status" className="min-w-0 flex-1 break-words">
        {`#${result.staffResourceId} ${result.staffName} 已并入 #${result.userResourceId} ${result.userName}。`}
        {result.cacheRefreshed ? '页面缓存已刷新。' : '页面缓存没有刷新。'}
      </p>
      {result.cacheRefreshed ? null : result.retry ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={result.pending}
          onClick={onRetry}
        >
          {result.pending ? '正在刷新缓存…' : '仅刷新缓存'}
        </Button>
      ) : (
        <span className="text-muted-foreground">
          没有可用的页面标识，不能刷新缓存。
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="关闭合并结果"
        disabled={result.pending}
        onClick={onClose}
      >
        <X />
      </Button>
      {result.error ? (
        <p role="alert" className="w-full break-words text-destructive">
          {result.error}
        </p>
      ) : null}
    </div>
  )
}
