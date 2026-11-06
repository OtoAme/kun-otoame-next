'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { ArrowLeft } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '~/components/dashboard/ui/button'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useResizableLayout
} from '~/components/dashboard/ui/resizable'
import { useIsMobile } from '~/hooks/dashboard/use-mobile'
import {
  useSearchableList,
  type SearchableListConfig
} from '~/hooks/dashboard/useSearchableList'
import { kunFetchPost } from '~/utils/kunFetch'
import type {
  MergeTab,
  OfficialMirrorCacheRefresh
} from '~/types/api/officialMirror'
import {
  MERGE_SORTS,
  MERGE_TABS,
  OFFICIAL_MIRROR_SECTIONS,
  MERGE_PAIR_FILTERS
} from '~/types/api/officialMirror'
import {
  acceptMergeListRow,
  mergeListCounts,
  type MergeListRow
} from '../contract'
import { BatchListSheet } from './BatchListSheet'
import { MergeHeader } from './MergeHeader'
import { MergeQueueList } from './MergeQueueList'
import { MergeWorkbench, type SingleMergeOutcome } from './MergeWorkbench'
import { SingleMergeBar, type SettledMerge } from './SingleMergeBar'
import { useMergeBatchList } from './useMergeBatchList'

const oneOf =
  (allowed: readonly string[]) =>
  (raw: string): string | null =>
    allowed.includes(raw) ? raw : null

export const MERGE_LIST_CONFIG: SearchableListConfig = {
  endpoint: '/admin/resource-merges',
  field: 'items',
  fallbackError: '获取资源合并队列失败，请稍后重试',
  acceptRow: acceptMergeListRow,
  filters: {
    tab: oneOf(MERGE_TABS),
    pairClass: oneOf(MERGE_PAIR_FILTERS),
    section: oneOf(OFFICIAL_MIRROR_SECTIONS),
    sort: oneOf(MERGE_SORTS)
  },
  defaultParams: { tab: 'pending' }
}

// Saved layouts must keep the same panel keys across navigation.
const PANEL_IDS = ['resource-merge-list', 'resource-merge-workbench']

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect

/**
 * 资源合并工作台. The list of user cards on the left, the workbench of the
 * selected card on the right. The selection is the URL `id`, so a card opens
 * by id even when it is not on the current list page.
 */
export function MergeWorkbenchPage() {
  const list = useSearchableList<MergeListRow>(MERGE_LIST_CONFIG)
  const isMobile = useIsMobile()
  const { defaultLayout, onLayoutChanged, groupRef } = useResizableLayout({
    id: 'dashboard-resource-merges',
    panelIds: PANEL_IDS
  })
  const rawTab = list.query.filters.tab
  const tab: MergeTab = MERGE_TABS.includes(rawTab as MergeTab)
    ? (rawTab as MergeTab)
    : 'pending'
  const selected = list.query.selected

  // Counts stay on the tabs while the next response loads.
  const [counts, setCounts] = useState<Record<MergeTab, number> | null>(null)
  const responseCounts = mergeListCounts(list.response)
  useEffect(() => {
    if (responseCounts) setCounts(responseCounts)
  }, [
    responseCounts?.pending,
    responseCounts?.dismissed,
    responseCounts?.merged
  ])

  // Async completions read the newest list state, not their render's.
  const rowsRef = useRef(list.rows)
  rowsRef.current = list.rows
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const selectRef = useRef(list.select)
  selectRef.current = list.select
  const refresh = list.refresh

  const [reloadNonce, setReloadNonce] = useState(0)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [settled, setSettled] = useState<SettledMerge | null>(null)

  const batch = useMergeBatchList({
    onFinished: (lines) => {
      const mergedCount = lines.filter(
        (line) => line.status === 'merged'
      ).length
      if (mergedCount > 0) {
        toast.success(`合并成功 ${mergedCount} 对，详细结果请查看批量清单`)
      }
      refresh()
      setReloadNonce((nonce) => nonce + 1)
    }
  })

  /** Opens the row after `userResourceId`, unless the admin moved on. */
  const advanceFrom = useCallback((userResourceId: number) => {
    if (selectedRef.current !== userResourceId) return
    const rows = rowsRef.current
    const index = rows.findIndex((row) => row.id === userResourceId)
    const next =
      index >= 0
        ? (rows[index + 1] ?? rows[index - 1])
        : rows.find((row) => row.id !== userResourceId)
    selectRef.current(next ? next.id : null, 'replace')
  }, [])

  const handleMerged = useCallback(
    (outcome: SingleMergeOutcome) => {
      toast.success(
        `合并成功：官方资源 #${outcome.staffResourceId} 已并入社区资源 #${outcome.userResourceId}`
      )
      setSettled({ ...outcome, pending: false, error: '' })
      batch.removeUser(outcome.userResourceId)
      refresh()
      advanceFrom(outcome.userResourceId)
    },
    [advanceFrom, batch.removeUser, refresh]
  )

  const handleHandled = useCallback(
    (result: { userResourceId: number; advance: boolean }) => {
      refresh()
      if (result.advance) advanceFrom(result.userResourceId)
    },
    [advanceFrom, refresh]
  )

  const retrySettled = async () => {
    const current = settled
    if (!current?.retry || current.pending) return
    const same = (item: SettledMerge | null) =>
      item !== null &&
      item.userResourceId === current.userResourceId &&
      item.staffResourceId === current.staffResourceId
    const body = current.retry
    setSettled((item) =>
      same(item) ? { ...item!, pending: true, error: '' } : item
    )
    try {
      const response = await kunFetchPost<OfficialMirrorCacheRefresh | string>(
        '/admin/backup/refresh-cache',
        body
      )
      setSettled((item) => {
        if (!same(item)) return item
        if (typeof response === 'string') {
          return {
            ...item!,
            pending: false,
            error: response || '刷新缓存失败，请稍后重试'
          }
        }
        if (
          response?.cacheRefreshed !== true ||
          response.uniqueIds?.[0] !== body.uniqueIds[0]
        ) {
          return { ...item!, pending: false, error: '页面缓存仍未刷新' }
        }
        return {
          ...item!,
          pending: false,
          cacheRefreshed: true,
          retry: null,
          error: ''
        }
      })
    } catch {
      setSettled((item) =>
        same(item)
          ? { ...item!, pending: false, error: '网络错误，缓存没有刷新' }
          : item
      )
    }
  }

  // Swapping the mobile list and workbench restarts the flow at the top.
  const scrollRef = useRef<HTMLDivElement | null>(null)
  useIsomorphicLayoutEffect(() => {
    if (!isMobile) return
    scrollRef.current?.scrollTo?.({ top: 0 })
  }, [isMobile, selected])

  const settledBar = settled ? (
    <SingleMergeBar
      result={settled}
      onRetry={() => void retrySettled()}
      onClose={() => setSettled(null)}
    />
  ) : null

  const listPane = (
    <MergeQueueList
      rows={list.rows}
      tab={tab}
      total={list.loading || list.error !== null ? null : list.total}
      page={list.query.page}
      limit={list.query.limit}
      loading={list.loading}
      error={list.error}
      filtered={
        Boolean(list.query.search) ||
        Boolean(list.query.filters.section) ||
        Boolean(list.query.filters.pairClass)
      }
      selectedId={selected}
      onSelect={(id) => list.select(id)}
      onPageChange={list.setPage}
      onRetry={refresh}
    />
  )

  const workbenchPane = (
    <div className="flex h-full min-h-0 min-w-0 flex-col max-md:h-auto">
      {isMobile ? (
        <div className="border-b bg-background px-2 py-1.5 max-md:sticky max-md:top-0 max-md:z-20">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => list.select(null)}
          >
            <ArrowLeft className="size-4" aria-hidden />
            返回列表
          </Button>
        </div>
      ) : null}
      {settledBar}
      {selected !== null ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col max-md:flex-none">
          <MergeWorkbench
            key={selected}
            userResourceId={selected}
            tab={tab}
            reloadNonce={reloadNonce}
            batch={batch}
            onMerged={handleMerged}
            onHandled={handleHandled}
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <p className="text-sm text-muted-foreground">
            选择一张用户资源开始核对。
          </p>
        </div>
      )}
    </div>
  )

  return (
    <div
      ref={scrollRef}
      aria-label="资源合并"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto md:overflow-hidden"
    >
      <MergeHeader
        tab={tab}
        counts={counts}
        filters={list.query.filters}
        search={list.query.search}
        batchCount={batch.items.length}
        refreshing={list.refreshing}
        onSearch={list.commitSearch}
        onFilters={list.setFilters}
        onRefresh={() => {
          refresh()
          setReloadNonce((nonce) => nonce + 1)
        }}
        onOpenBatch={() => setSheetOpen(true)}
      />
      {isMobile ? (
        <div className="min-w-0 flex-none">
          {selected === null ? (
            <>
              {settledBar}
              {listPane}
            </>
          ) : (
            workbenchPane
          )}
        </div>
      ) : (
        <ResizablePanelGroup
          orientation="horizontal"
          groupRef={groupRef}
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
          className="min-h-0 min-w-0 flex-1"
        >
          <ResizablePanel
            id={PANEL_IDS[0]}
            defaultSize="25%"
            minSize="240px"
            className="min-h-0 min-w-0"
          >
            {listPane}
          </ResizablePanel>
          <ResizableHandle
            withHandle
            aria-label="调整用户资源列表和工作台宽度"
          />
          <ResizablePanel
            id={PANEL_IDS[1]}
            defaultSize="75%"
            minSize="420px"
            className="min-h-0 min-w-0"
          >
            {workbenchPane}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
      <BatchListSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        batch={batch}
      />
    </div>
  )
}
