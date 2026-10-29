'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Unlink } from 'lucide-react'

import { Button } from '~/components/dashboard/ui/button'
import { Skeleton } from '~/components/dashboard/ui/skeleton'
import { BrokenLinkInboxDetail } from '~/components/dashboard/inbox/BrokenLinkInboxDetail'
import { cn } from '~/lib/dashboard/utils'
import { kunFetchGet } from '~/utils/kunFetch'
import type { BrokenLinkInboxItem, InboxListResponse } from '~/types/api/inbox'

const waitingText = (seconds: number) => {
  const days = Math.floor(seconds / 86400)
  if (days >= 1) return `已失效 ${days} 天`
  const hours = Math.floor(seconds / 3600)
  return hours >= 1 ? `已失效 ${hours} 小时` : '失效不足 1 小时'
}

/**
 * Broken resource-disk links waiting on the staff, oldest first. They are
 * not cases, so they come from the inbox endpoint filtered to that one kind;
 * the detail is the same component the inbox used.
 */
export function BrokenLinkQueue({
  isMobile,
  onCountChange
}: {
  isMobile: boolean
  /** Lets the shell's pending count refresh after the list reloads. */
  onCountChange?: () => void
}) {
  const [items, setItems] = useState<BrokenLinkInboxItem[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    const request = ++requestRef.current
    setLoading(true)
    setError('')
    try {
      const result = await kunFetchGet<InboxListResponse | string>(
        '/admin/inbox',
        { kinds: 'broken-link', limitPerKind: 50 }
      )
      if (request !== requestRef.current) return
      if (typeof result === 'string') {
        setError(result || '读取失效链接失败')
        return
      }
      setItems(
        result.items.filter(
          (item): item is BrokenLinkInboxItem => item.kind === 'broken-link'
        )
      )
    } catch {
      if (request === requestRef.current) {
        setError('网络错误，读取失效链接失败')
      }
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const selected = items?.find((item) => item.key === selectedKey) ?? null

  const list = (
    <div className="min-h-0 overflow-y-auto">
      {error ? (
        <div role="alert" className="flex flex-col items-center gap-3 p-6">
          <p className="text-sm text-muted-foreground">加载失败：{error}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            重试
          </Button>
        </div>
      ) : items === null ? (
        <div role="status" aria-label="正在加载" className="divide-y">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="space-y-2 px-3 py-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">
          没有失效的资源盘链接
        </p>
      ) : (
        <ul className="divide-y" aria-label="资源盘失效链接">
          {items.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                aria-current={item.key === selectedKey ? 'true' : undefined}
                onClick={() => setSelectedKey(item.key)}
                className={cn(
                  'flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
                  item.key === selectedKey && 'bg-accent'
                )}
              >
                <Unlink
                  className="mt-0.5 size-4 shrink-0 text-destructive"
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {item.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.subtitle} ·{' '}
                    {item.payload.link.hostname ?? '无法解析主机'}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {waitingText(item.waitingSeconds)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  const detail = selected ? (
    <div className="min-h-0 overflow-y-auto p-4">
      {isMobile ? (
        <Button
          variant="ghost"
          size="sm"
          className="mb-2"
          onClick={() => setSelectedKey(null)}
        >
          <ArrowLeft className="size-4" aria-hidden />
          返回列表
        </Button>
      ) : null}
      <BrokenLinkInboxDetail
        item={selected}
        onProcessed={() => {
          setSelectedKey(null)
          void load()
          onCountChange?.()
        }}
      />
    </div>
  ) : null

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b px-3 py-2">
        <span className="text-xs text-muted-foreground">
          {items ? `共 ${items.length} 条` : '读取中…'}
          {loading && items ? '，更新中…' : ''}
          {' · '}只含资源盘（站方存储）的链接，其他网盘失效由发布者处理
        </span>
      </div>
      {/* Like the case queues: the list takes the full width until a row is
          opened; then list and detail sit side by side (stacked on phones). */}
      {isMobile ? (
        selected ? (
          detail
        ) : (
          list
        )
      ) : selected ? (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(280px,34%)_minmax(0,1fr)] divide-x">
          {list}
          {detail}
        </div>
      ) : (
        list
      )}
    </div>
  )
}
