'use client'

import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'

import { Button } from '~/components/dashboard/ui/button'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '~/components/dashboard/ui/resizable'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import { CASE_KIND_LABELS, OPEN_CASE_KINDS } from '~/constants/case'
import { cn } from '~/lib/dashboard/utils'
import type { AdminCaseListItem, AdminCaseListResponse } from '~/types/api/case'

import { DashboardCaseDetail } from './DashboardCaseDetail'
import { CaseQueueList, type CaseQueueLayout } from './CaseQueueList'
import type { CaseCenterView } from './caseCenterViews'

export const ALL_CASE_KINDS = 'all'

interface CaseQueueProps {
  view: CaseCenterView
  list: AdminCaseListResponse | null
  rows: AdminCaseListItem[]
  loading: boolean
  error: string
  onRetry: () => void
  page: number
  pageSize: number
  caseKind: string
  searchActive: boolean
  selectedId: number | null
  selectionStatus: 'none' | 'invalid' | 'ok'
  isMobile: boolean
  onKindChange: (kind: string) => void
  onPageChange: (page: number) => void
  onSelect: (row: AdminCaseListItem) => void
  onClearSelection: () => void
  onProcessed: () => void
  onStateChanged: () => void
}

function StatePanel({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      {children}
    </div>
  )
}

/**
 * One queue of the case center: kind filter, the list, and the detail it
 * opens. Nothing selected means the list owns the full width and switches to
 * the aligned column layout of the reference queue mock; opening a case hands
 * most of the width to the detail and the rows fall back to cards.
 *
 * Responsive contract, unchanged from the unified inbox: on mobile neither
 * pane scrolls or clips itself so list and detail join the page flow; from md
 * up each pane keeps its own scroller.
 */
export function CaseQueue({
  view,
  list,
  rows,
  loading,
  error,
  onRetry,
  page,
  pageSize,
  caseKind,
  searchActive,
  selectedId,
  selectionStatus,
  isMobile,
  onKindChange,
  onPageChange,
  onSelect,
  onClearSelection,
  onProcessed,
  onStateChanged
}: CaseQueueProps) {
  let detailBody: ReactNode = null
  if (selectionStatus === 'invalid') {
    detailBody = (
      <StatePanel>
        <p className="text-sm">事项链接无效</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onClearSelection}
        >
          返回列表
        </Button>
      </StatePanel>
    )
  } else if (selectedId !== null) {
    detailBody = (
      <DashboardCaseDetail
        key={selectedId}
        caseId={selectedId}
        onProcessed={onProcessed}
        onStateChanged={onStateChanged}
      />
    )
  }

  const detailPanel = (
    <div className="flex h-full min-h-0 min-w-0 flex-col max-md:h-auto">
      {isMobile ? (
        <div className="border-b bg-background px-2 py-1.5 max-md:sticky max-md:top-0 max-md:z-10">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClearSelection}
          >
            <ArrowLeft className="size-4" aria-hidden />
            返回列表
          </Button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 outline-none max-md:flex-none max-md:overflow-visible">
        {detailBody}
      </div>
    </div>
  )

  const layout: CaseQueueLayout =
    !isMobile && selectionStatus === 'none' ? 'table' : 'card'

  const listPanel = (
    <CaseQueueList
      rows={rows}
      total={list ? list.total : null}
      page={page}
      limit={list ? list.limit : pageSize}
      now={list ? list.now : null}
      loading={loading}
      error={error}
      selectedId={selectedId}
      emptyText={view.emptyText}
      searchActive={searchActive}
      layout={layout}
      onSelect={onSelect}
      onPageChange={onPageChange}
      onRetry={onRetry}
    />
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden max-md:flex-none max-md:overflow-visible">
      <div
        className={cn(
          'flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2',
          // The mobile list view pins the filter row; the detail view lets it
          // scroll away and pins only its own back row.
          selectionStatus === 'none' &&
            'bg-background max-md:sticky max-md:top-0 max-md:z-10'
        )}
      >
        <Select value={caseKind || ALL_CASE_KINDS} onValueChange={onKindChange}>
          <SelectTrigger aria-label="事项类型" className="h-8 w-[8.5rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CASE_KINDS}>全部类型</SelectItem>
            {OPEN_CASE_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {CASE_KIND_LABELS[kind]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {list === null ? `已显示 ${rows.length} 条` : `共 ${list.total} 条`}
          {loading && rows.length > 0 ? '，更新中…' : ''}
        </span>
      </div>

      {isMobile ? (
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden max-md:flex-none max-md:overflow-visible">
          {selectionStatus === 'none' ? listPanel : detailPanel}
        </div>
      ) : selectionStatus === 'none' ? (
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden max-md:flex-none max-md:overflow-visible">
          {listPanel}
        </div>
      ) : (
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 min-w-0 flex-1"
        >
          <ResizablePanel
            defaultSize="34%"
            minSize="280px"
            className="min-h-0 min-w-0"
          >
            {listPanel}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            defaultSize="66%"
            minSize="320px"
            className="min-h-0 min-w-0"
          >
            {detailPanel}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  )
}
