'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import type { ReactNode, TouchEvent as ReactTouchEvent } from 'react'
import { ArrowLeft, Inbox as InboxIcon } from 'lucide-react'

import { Button } from '~/components/dashboard/ui/button'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '~/components/dashboard/ui/resizable'
import { useIsMobile } from '~/hooks/dashboard/use-mobile'
import { useInbox } from '~/hooks/dashboard/useInbox'

import { useDashboard } from './DashboardShell'
import { InboxDetail } from './inbox/InboxDetail'
import { InboxDetailSkeleton } from './inbox/InboxDetailSkeleton'
import { InboxListPane } from './inbox/InboxListPane'
import { InboxToolbar } from './inbox/InboxToolbar'

export interface DashboardInboxProps {
  reviewerId: number
  reviewerRole: number
}

// Downward pull distance on the back row that scrolls the shared page flow
// back to the top. Chosen well above the tap slop so a pull is not treated
// as a back-button tap.
const BACK_ROW_PULL_DISTANCE = 48

// Scroll-position resets must run before paint so a freshly swapped mobile
// view never flashes at the previous offset; useEffect is the SSR fallback,
// where no scroll position exists anyway.
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect

function StatePanel({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      {children}
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
  const sectionRef = useRef<HTMLElement | null>(null)
  const backRowTouchStartY = useRef<number | null>(null)

  // Header, toolbar and the active mobile pane share the inset scroller.
  const getScroller = useCallback((): HTMLElement | null => {
    return (
      sectionRef.current?.closest<HTMLElement>('[data-dashboard-scroll]') ??
      null
    )
  }, [])

  // Entering a different mobile view (list, detail, invalid selection, or
  // another item) restarts the shared flow at the top so the full chrome is
  // visible first. Desktop keeps its two independent pane scrollers and is
  // never touched here.
  useIsomorphicLayoutEffect(() => {
    if (!isMobile) {
      return
    }
    getScroller()?.scrollTo({ top: 0 })
  }, [isMobile, selectionStatus, selectedKey, getScroller])

  // Leaving the inbox route must not leak a scrolled position into the next
  // dashboard page, which shares the same container. The container outlives
  // this component, so it is captured once at mount for the unmount cleanup.
  useEffect(() => {
    const scroller = getScroller()
    return () => {
      scroller?.scrollTo({ top: 0 })
    }
  }, [getScroller])

  // A downward pull on the stuck back row scrolls the shared flow back to
  // the top, revealing the full header and toolbar. The gesture also drags
  // the flow naturally; this only completes the trip, smoothly unless the
  // user prefers reduced motion. Clicking the back button is untouched.
  const handleBackRowTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    backRowTouchStartY.current = event.touches[0]?.clientY ?? null
  }

  const handleBackRowTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    const startY = backRowTouchStartY.current
    if (startY === null) {
      return
    }
    const currentY = event.touches[0]?.clientY
    if (currentY !== undefined && currentY - startY > BACK_ROW_PULL_DISTANCE) {
      backRowTouchStartY.current = null
      const reduceMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
      ).matches
      getScroller()?.scrollTo({
        top: 0,
        behavior: reduceMotion ? 'auto' : 'smooth'
      })
    }
  }

  const handleBackRowTouchEnd = () => {
    backRowTouchStartY.current = null
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      if (event.repeat) return // 忽略长按自动重复，防止连发
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
        // Focusing the search input also makes the browser scroll the
        // shared flow back up to the toolbar when it is scrolled away.
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
    detailBody = <InboxDetailSkeleton />
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
    } else if (
      data.state === 'processed' &&
      !(inbox.historyMode && data.item.kind === 'submission')
    ) {
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
    detailBody = <InboxDetailSkeleton />
  }

  // On mobile none of these containers scrolls or clips: height is
  // content-driven so the whole detail (back row plus body) participates in
  // the shared page flow. The back row sticks to the container top once it
  // reaches it; bg-background keeps scrolled content from showing through.
  // From md up the original fixed-height, independently scrolling pane is
  // preserved exactly.
  const detailPanel = (
    <div className="flex h-full min-h-0 min-w-0 flex-col max-md:h-auto">
      {isMobile ? (
        <div
          className="border-b bg-background px-2 py-1.5 max-md:sticky max-md:top-0 max-md:z-10"
          onTouchStart={handleBackRowTouchStart}
          onTouchMove={handleBackRowTouchMove}
          onTouchEnd={handleBackRowTouchEnd}
          onTouchCancel={handleBackRowTouchEnd}
        >
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
        className="min-h-0 flex-1 overflow-y-auto p-4 outline-none max-md:flex-none max-md:overflow-visible"
      >
        {detailBody}
      </div>
    </div>
  )

  return (
    <section
      ref={sectionRef}
      aria-label="待办处理"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden max-md:flex-none max-md:overflow-visible"
    >
      <InboxToolbar
        inbox={inbox}
        searchRef={searchRef}
        helpOpen={helpOpen}
        onHelpOpenChange={setHelpOpen}
      />
      {isMobile ? (
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden max-md:flex-none max-md:overflow-visible">
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
