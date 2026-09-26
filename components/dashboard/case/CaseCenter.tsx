'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import type { FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronRight, RefreshCw, Search } from 'lucide-react'

import { Button } from '~/components/dashboard/ui/button'
import { Input } from '~/components/dashboard/ui/input'
import { useIsMobile } from '~/hooks/dashboard/use-mobile'
import { OPEN_CASE_KINDS } from '~/constants/case'
import { cn } from '~/lib/dashboard/utils'
import type { AdminCaseListItem, CaseStatusCounts } from '~/types/api/case'

import { useDashboard } from '../DashboardShell'
import { CaseCenterNav } from './CaseCenterNav'
import { CaseOverview } from './CaseOverview'
import { ALL_CASE_KINDS, CaseQueue } from './CaseQueue'
import {
  DEFAULT_CASE_VIEW,
  UNRESOLVED_CASE_VIEW,
  findCaseView,
  isPublisherCaseView,
  type CaseCenterView
} from './caseCenterViews'
import { useCaseList } from './useCaseList'

/** Case center base path; `/dashboard/case/[id]` normalizes back to it. */
const BASE_PATH = '/dashboard/case'
const QUEUE_PAGE_SIZE = 20
/** The overview only needs the head of the oldest-first default queue. */
const OVERVIEW_PAGE_SIZE = 6
const SEARCH_MAX = 300
const PG_INT_MAX = 2147483647

const OPEN_KIND_SET: ReadonlySet<string> = new Set(OPEN_CASE_KINDS)

const parseCaseKind = (raw: string | null): string =>
  raw !== null && OPEN_KIND_SET.has(raw) ? raw : ''

const parseSearch = (raw: string | null): string =>
  (raw ?? '').trim().slice(0, SEARCH_MAX)

const parsePage = (raw: string | null): number => {
  const page = Number(raw)
  return Number.isSafeInteger(page) && page >= 1 && page <= PG_INT_MAX
    ? page
    : 1
}

/** Publisher filter of the publisher view: a user id, or '' for none. */
const parseOwnerId = (raw: string | null): string => {
  if (!raw || !/^[1-9]\d*$/.test(raw)) return ''
  return Number(raw) <= PG_INT_MAX ? raw : ''
}

type SelectionParse =
  | { status: 'none' }
  | { status: 'invalid' }
  | { status: 'ok'; id: number }

const parseSelection = (raw: string | null): SelectionParse => {
  if (raw == null) return { status: 'none' }
  if (!/^[1-9]\d*$/.test(raw)) return { status: 'invalid' }
  const id = Number(raw)
  if (!Number.isSafeInteger(id) || id > PG_INT_MAX) {
    return { status: 'invalid' }
  }
  return { status: 'ok', id }
}

// Scroll-position resets must run before paint so a freshly swapped mobile
// view never flashes at the previous offset; useEffect is the SSR fallback.
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect

export interface CaseCenterProps {
  /** Set by the `/dashboard/case/[id]` deep link; wins over `?id=`. */
  initialCaseId?: number
}

/**
 * 工单中心. A self-contained operations console for staff-owned cases: its
 * own secondary navigation, overview and queues, living inside the dashboard
 * shell so authentication, the global sidebar and the header are not
 * duplicated. The unified inbox keeps the case source for queueing and links
 * in here; this is the only place a case is actually handled.
 */
export function CaseCenter({ initialCaseId }: CaseCenterProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { counts, countsLoading, refreshCounts } = useDashboard()
  const isMobile = useIsMobile()

  const rawView = searchParams.get('view')
  // A `/dashboard/case/[id]` deep link carries no view, but the overview has
  // no detail pane, so it opens on the default queue instead.
  const view =
    rawView !== null
      ? findCaseView(rawView)
      : initialCaseId !== undefined
        ? UNRESOLVED_CASE_VIEW
        : DEFAULT_CASE_VIEW
  const caseKind = parseCaseKind(searchParams.get('caseKind'))
  const search = parseSearch(searchParams.get('search'))
  const publisherView = isPublisherCaseView(view)
  const ownerId = publisherView ? parseOwnerId(searchParams.get('owner')) : ''
  const page = parsePage(searchParams.get('page'))
  const paramSelection = parseSelection(searchParams.get('id'))
  const selection: SelectionParse =
    initialCaseId !== undefined
      ? { status: 'ok', id: initialCaseId }
      : paramSelection
  const selectionStatus = selection.status
  const selectedId = selection.status === 'ok' ? selection.id : null

  const isOverview = view.countKeys === null
  const listQuery = {
    // The overview reports on the staff queue, so it reuses that filter.
    params: isOverview ? UNRESOLVED_CASE_VIEW.params : view.params,
    kind: isOverview ? '' : caseKind,
    search: isOverview ? '' : search,
    ownerId,
    page: isOverview ? 1 : page,
    limit: isOverview ? OVERVIEW_PAGE_SIZE : QUEUE_PAGE_SIZE
  }
  const { list, rows, rowsRef, statusCounts, loading, error, refetch } =
    useCaseList(listQuery)

  // Navigation badges count the staff queue. The publisher view's counts are
  // publisher-scoped, so while it is open the badges keep the last staff ones.
  const [staffCounts, setStaffCounts] = useState<CaseStatusCounts | null>(null)
  useEffect(() => {
    if (!publisherView && statusCounts) setStaffCounts(statusCounts)
  }, [publisherView, statusCounts])
  const navCounts = publisherView ? staffCounts : statusCounts

  const [searchText, setSearchText] = useState(search)
  // Reflect the URL-driven search value (back/forward navigation) in the input.
  useEffect(() => {
    setSearchText(search)
  }, [search])

  const selectedIdRef = useRef<number | null>(null)
  selectedIdRef.current = selectedId

  const navigate = useCallback(
    (
      patch: {
        view?: CaseCenterView
        caseKind?: string
        search?: string
        ownerId?: string
        page?: number
        selection?: number | null
      },
      mode: 'push' | 'replace' = 'push'
    ) => {
      const next = {
        view: patch.view ?? view,
        caseKind: patch.caseKind ?? caseKind,
        search: patch.search ?? search,
        ownerId: patch.ownerId ?? ownerId,
        page: patch.page ?? page,
        selection: patch.selection === undefined ? selectedId : patch.selection
      }
      const q = new URLSearchParams()
      if (next.view.value !== DEFAULT_CASE_VIEW.value) {
        q.set('view', next.view.value)
      }
      if (next.view.countKeys !== null) {
        if (next.caseKind) q.set('caseKind', next.caseKind)
        if (next.search) q.set('search', next.search)
        if (next.ownerId && isPublisherCaseView(next.view)) {
          q.set('owner', next.ownerId)
        }
        if (next.page > 1) q.set('page', String(next.page))
        if (next.selection !== null) q.set('id', String(next.selection))
      }
      const query = q.toString()
      const href = query ? `${BASE_PATH}?${query}` : BASE_PATH
      if (mode === 'replace') router.replace(href, { scroll: false })
      else router.push(href, { scroll: false })
    },
    [view, caseKind, search, ownerId, page, selectedId, router]
  )

  // A filter change is a new result set: back to page 1. The open detail is
  // self-contained and stays open, matching the inbox's outside-window rule.
  const handleSelectView = (next: CaseCenterView) => {
    navigate({ view: next, page: 1 })
  }
  const handleKindChange = (value: string) => {
    navigate({ caseKind: value === ALL_CASE_KINDS ? '' : value, page: 1 })
  }
  const handleOwnerIdChange = (value: string) => {
    navigate({ ownerId: parseOwnerId(value), page: 1 })
  }
  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = searchText.trim().slice(0, SEARCH_MAX)
    // Search has no meaning on the overview: run it against the default queue.
    navigate(
      isOverview
        ? {
            view: UNRESOLVED_CASE_VIEW,
            search: value,
            page: 1,
            selection: null
          }
        : { search: value, page: 1 }
    )
  }
  const handlePageChange = (nextPage: number) => {
    navigate({ page: Math.max(1, nextPage) })
  }
  const handleSelect = (row: AdminCaseListItem) => {
    navigate(
      isOverview
        ? { view: UNRESOLVED_CASE_VIEW, selection: row.id }
        : { selection: row.id }
    )
  }
  const clearSelection = useCallback(
    () => navigate({ selection: null }),
    [navigate]
  )

  // Hand-edited or shrunk tail page: resolve to the real last page once the
  // standing query reports its total. Never leaves page 1 for an empty filter.
  useEffect(() => {
    if (!list || isOverview) return
    if (page > 1 && rows.length === 0 && list.total > 0) {
      navigate(
        { page: Math.max(1, Math.ceil(list.total / QUEUE_PAGE_SIZE)) },
        'replace'
      )
    }
  }, [list, isOverview, page, rows.length, navigate])

  // Terminal actions: advance to the neighbor row like the unified inbox,
  // then refresh the list and the shell's pending counts exactly once.
  const handleProcessed = useCallback(() => {
    const id = selectedIdRef.current
    if (id !== null) {
      const currentRows = rowsRef.current
      const index = currentRows.findIndex((row) => row.id === id)
      const next =
        index >= 0
          ? (currentRows[index + 1] ?? currentRows[index - 1])
          : undefined
      navigate({ selection: next ? next.id : null }, 'replace')
    }
    refetch()
    void refreshCounts()
  }, [navigate, refetch, refreshCounts, rowsRef])

  // Non-terminal changes (reply): the row's status badge may have changed.
  const handleStateChanged = useCallback(() => {
    refetch()
  }, [refetch])

  const handleRefresh = () => {
    refetch()
    void refreshCounts()
  }

  // The center owns its scrolling: below md the whole console is one flow,
  // from md up it is fixed and the inner panes scroll independently.
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Entering a different mobile view restarts the flow at the top.
  useIsomorphicLayoutEffect(() => {
    if (!isMobile) return
    scrollRef.current?.scrollTo({ top: 0 })
  }, [isMobile, view.value, selectionStatus, selectedId])

  const detailOpen = selectionStatus !== 'none'

  return (
    <div
      ref={scrollRef}
      aria-label="工单中心"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto md:overflow-hidden"
    >
      <div className="flex min-h-0 min-w-0 flex-1 md:overflow-hidden">
        {/*
          The rail is the reference mock's left navigation, and a detail view
          never shows it. Letting a breakpoint insert a fixed 14rem column
          there took 224px out of the three-column detail in a single step —
          the conversation fell from 531px to 384px across one pixel of
          viewport. The strip has no such step, and it is already the mode
          every size below that breakpoint used.
        */}
        {detailOpen ? null : (
          <CaseCenterNav
            current={view}
            statusCounts={navCounts}
            orientation="vertical"
            onSelect={handleSelectView}
            className="hidden lg:block"
          />
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2">
            <nav aria-label="面包屑" className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isOverview}
                onClick={() => handleSelectView(DEFAULT_CASE_VIEW)}
              >
                工单中心
              </Button>
              {isOverview ? null : (
                <>
                  <ChevronRight
                    className="size-3.5 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="text-sm font-medium">{view.label}</span>
                </>
              )}
            </nav>

            <form
              role="search"
              onSubmit={handleSearchSubmit}
              className="flex min-w-[10rem] flex-1 items-center gap-2"
            >
              <label htmlFor="case-center-search" className="sr-only">
                搜索事项
              </label>
              <Input
                id="case-center-search"
                type="search"
                autoComplete="off"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                maxLength={SEARCH_MAX}
                placeholder="搜索编号、类型或内容"
                className="h-8 min-w-0 flex-1"
              />
              <Button type="submit" variant="secondary" size="sm">
                <Search className="size-4" aria-hidden />
                搜索
              </Button>
            </form>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={handleRefresh}
            >
              <RefreshCw
                className={cn('size-4', loading && 'animate-spin')}
                aria-hidden
              />
              刷新
            </Button>
          </div>

          <CaseCenterNav
            current={view}
            statusCounts={navCounts}
            orientation="horizontal"
            onSelect={handleSelectView}
            className={cn(!detailOpen && 'lg:hidden')}
          />

          {isOverview ? (
            <div className="min-h-0 min-w-0 flex-1 md:overflow-y-auto">
              <CaseOverview
                counts={counts}
                countsLoading={countsLoading}
                statusCounts={statusCounts}
                rows={rows}
                list={list}
                loading={loading}
                error={error}
                onRetry={refetch}
                onSelectCase={handleSelect}
                onOpenQueue={() => handleSelectView(UNRESOLVED_CASE_VIEW)}
              />
            </div>
          ) : (
            <CaseQueue
              view={view}
              list={list}
              rows={rows}
              loading={loading}
              error={error}
              onRetry={refetch}
              page={page}
              pageSize={QUEUE_PAGE_SIZE}
              caseKind={caseKind}
              ownerId={ownerId}
              searchActive={search.trim().length > 0}
              selectedId={selectedId}
              selectionStatus={selectionStatus}
              isMobile={isMobile}
              onKindChange={handleKindChange}
              onOwnerIdChange={handleOwnerIdChange}
              onPageChange={handlePageChange}
              onSelect={handleSelect}
              onClearSelection={clearSelection}
              onProcessed={handleProcessed}
              onStateChanged={handleStateChanged}
            />
          )}
        </div>
      </div>
    </div>
  )
}
