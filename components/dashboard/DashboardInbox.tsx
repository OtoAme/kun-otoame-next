'use client'

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, Inbox as InboxIcon } from 'lucide-react'

import { Button } from '~/components/dashboard/ui/button'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '~/components/dashboard/ui/resizable'
import { Skeleton } from '~/components/dashboard/ui/skeleton'
import { useIsMobile } from '~/hooks/dashboard/use-mobile'
import { useInbox } from '~/hooks/dashboard/useInbox'

import { useDashboard } from './DashboardShell'
import { InboxDetail } from './inbox/InboxDetail'
import { InboxListPane } from './inbox/InboxListPane'
import { InboxToolbar } from './inbox/InboxToolbar'

export interface DashboardInboxProps {
  reviewerId: number
  reviewerRole: number
}

function StatePanel({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      {children}
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div role="status" aria-label="正在加载事项详情" className="space-y-3 p-4">
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-32 w-full" />
    </div>
  )
}

export function DashboardInbox({
  reviewerId,
  reviewerRole
}: DashboardInboxProps) {
  const { refreshCounts } = useDashboard()
  const inbox = useInbox({ refreshCounts })
  const {
    selectionStatus,
    selectedKey,
    item,
    itemLoading,
    itemError,
    itemsRef,
    selectItem,
    clearSelection,
    retryItem,
    refreshAll,
    onProcessed,
    onStateChanged
  } = inbox
  const isMobile = useIsMobile()

  const [helpOpen, setHelpOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const detailRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'
        )
      ) {
        return
      }
      const target = event.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        if (target.isContentEditable) return
        if (target.closest('[role="combobox"]')) return
      }
      const key = event.key

      if (key === 'ArrowDown' || key === 'ArrowUp') {
        const rows = itemsRef.current
        if (rows.length === 0) return
        event.preventDefault()
        const delta = key === 'ArrowDown' ? 1 : -1
        const current = rows.findIndex((row) => row.key === selectedKey)
        let next =
          current === -1 ? (delta > 0 ? 0 : rows.length - 1) : current + delta
        next = Math.max(0, Math.min(rows.length - 1, next))
        const row = rows[next]
        selectItem(row)
        document
          .querySelector(`[data-inbox-row-key="${row.key}"]`)
          ?.scrollIntoView({ block: 'nearest' })
        return
      }

      if (key === 'Enter') {
        const active = document.activeElement as HTMLElement | null
        if (active?.closest('button, a[href], [role="button"]')) return
        if (selectionStatus !== 'ok') {
          const rows = itemsRef.current
          if (rows.length > 0) {
            event.preventDefault()
            selectItem(rows[0])
          }
          return
        }
        event.preventDefault()
        detailRef.current?.focus()
        return
      }

      if (key === '/') {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }

      if (key === '?') {
        event.preventDefault()
        setHelpOpen(true)
        return
      }

      if (key === 'a' || key === 'd') {
        if (selectionStatus !== 'ok') return
        const fresh = item && item.key === selectedKey ? item : null
        const pending =
          fresh && fresh.data.state === 'pending' ? fresh.data.item : null
        if (!pending || pending.readOnly) return
        if (pending.kind === 'feedback' || pending.kind === 'report') return
        const root = detailRef.current
        if (!root) return
        const action = key === 'a' ? 'positive' : 'destructive'
        const button = root.querySelector<HTMLButtonElement>(
          `button[data-inbox-action="${action}"]`
        )
        if (button && !button.disabled) {
          event.preventDefault()
          button.click()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [itemsRef, item, selectItem, selectedKey, selectionStatus])

  const freshItem = item && item.key === selectedKey ? item : null

  let detailBody: ReactNode
  if (selectionStatus === 'none') {
    detailBody = (
      <StatePanel>
        <InboxIcon className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">
          从左侧列表选择一条待办事项查看详情
        </p>
      </StatePanel>
    )
  } else if (selectionStatus === 'invalid') {
    detailBody = (
      <StatePanel>
        <p className="text-sm">事项链接无效</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={clearSelection}
        >
          返回列表
        </Button>
      </StatePanel>
    )
  } else if (itemLoading) {
    detailBody = <DetailSkeleton />
  } else if (itemError) {
    detailBody = (
      <StatePanel>
        <p role="alert" className="text-sm text-muted-foreground">
          加载失败：{itemError}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={retryItem}>
          重试
        </Button>
      </StatePanel>
    )
  } else if (freshItem) {
    const { data } = freshItem
    if (data.state === 'missing') {
      detailBody = (
        <StatePanel>
          <p className="text-sm">该事项已不存在</p>
          <p className="text-xs text-muted-foreground">
            它可能已被其他审核员处理或删除。
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void refreshAll()
              }}
            >
              刷新列表
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearSelection}
            >
              返回列表
            </Button>
          </div>
        </StatePanel>
      )
    } else if (data.state === 'processed') {
      detailBody = (
        <StatePanel>
          <p className="text-sm">该事项已被处理</p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void refreshAll()
              }}
            >
              刷新列表
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearSelection}
            >
              返回列表
            </Button>
          </div>
        </StatePanel>
      )
    } else {
      detailBody = (
        <InboxDetail
          key={data.item.key}
          item={data.item}
          reviewerId={reviewerId}
          reviewerRole={reviewerRole}
          onProcessed={onProcessed}
          onStateChanged={onStateChanged}
        />
      )
    }
  } else {
    detailBody = <DetailSkeleton />
  }

  const detailPanel = (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {isMobile ? (
        <div className="border-b px-2 py-1.5">
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
      <div
        ref={detailRef}
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-y-auto p-4 outline-none"
      >
        {detailBody}
      </div>
    </div>
  )

  return (
    <section
      aria-label="待办处理"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <InboxToolbar
        inbox={inbox}
        searchRef={searchRef}
        helpOpen={helpOpen}
        onHelpOpenChange={setHelpOpen}
      />
      {isMobile ? (
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {selectionStatus === 'none' ? (
            <InboxListPane inbox={inbox} />
          ) : (
            detailPanel
          )}
        </div>
      ) : (
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 min-w-0 flex-1"
        >
          <ResizablePanel
            defaultSize="35%"
            minSize="260px"
            className="min-h-0 min-w-0"
          >
            <InboxListPane inbox={inbox} />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            defaultSize="65%"
            minSize="300px"
            className="min-h-0 min-w-0"
          >
            {detailPanel}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </section>
  )
}
