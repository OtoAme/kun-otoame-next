'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { RefreshCw, Search } from 'lucide-react'

import { Button } from '~/components/dashboard/ui/button'
import { Input } from '~/components/dashboard/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import { useIsMobile } from '~/hooks/dashboard/use-mobile'
import {
  CASE_SEARCH_FIELDS,
  CASE_SEARCH_FIELD_LABELS,
  CASE_SORT_FIELDS,
  CASE_STATUS_FILTERS,
  CASE_STATUS_FILTER_STATUSES,
  OPEN_CASE_KINDS,
  type CaseSearchField,
  type CaseSortField,
  type CaseSortOrder,
  type CaseStatusFilter
} from '~/constants/case'
import { cn } from '~/lib/dashboard/utils'
import type { AdminCaseListItem, CaseStatusCounts } from '~/types/api/case'

import { useDashboard } from '../DashboardShell'
import { BrokenLinkQueue } from './BrokenLinkQueue'
import { CaseCenterNav } from './CaseCenterNav'
import { ALL_CASE_KINDS, CaseQueue } from './CaseQueue'
import {
  DEFAULT_CASE_VIEW,
  findCaseView,
  isBrokenLinkView,
  isPublisherCaseView,
  type CaseCenterView,
  type CaseListParams
} from './caseCenterViews'
import { useCaseList } from './useCaseList'

/** Case center base path; `/dashboard/case/[id]` normalizes back to it. */
const BASE_PATH = '/dashboard/case'
const QUEUE_PAGE_SIZE = 20
const SEARCH_MAX = 300
const PG_INT_MAX = 2147483647

const OPEN_KIND_SET: ReadonlySet<string> = new Set(OPEN_CASE_KINDS)

const parseCaseKind = (raw: string | null): string =>
  raw !== null && OPEN_KIND_SET.has(raw) ? raw : ''

const parseSearch = (raw: string | null): string =>
  (raw ?? '').trim().slice(0, SEARCH_MAX)

const SEARCH_FIELD_SET: ReadonlySet<string> = new Set(CASE_SEARCH_FIELDS)
const parseSearchField = (raw: string | null): CaseSearchField =>
  raw !== null && SEARCH_FIELD_SET.has(raw) ? (raw as CaseSearchField) : 'all'

const SEARCH_PLACEHOLDERS: Record<CaseSearchField, string> = {
  all: '搜索编号、类型、游戏、资源、报告者或对话内容',
  id: '输入事项编号，如 8 或 #8',
  kind: '输入类型，如 条目资料有误',
  patch: '输入游戏名',
  resource: '输入资源名',
  reporter: '输入报告者用户名',
  content: '输入对话里的文字'
}

/**
 * Status filter options of a view: the groups its statuses reach into. A view
 * inside one group is that filter already, and the overview lists nothing.
 */
const statusFiltersFor = (view: CaseCenterView): CaseStatusFilter[] => {
  const keys = view.countKeys
  if (keys === null) return []
  const filters = CASE_STATUS_FILTERS.filter((filter) =>
    CASE_STATUS_FILTER_STATUSES[filter].some((status) => keys.includes(status))
  )
  return filters.length > 1 ? filters : []
}

const parseCaseStatus = (
  raw: string | null,
  filters: readonly CaseStatusFilter[]
): CaseStatusFilter | '' => filters.find((filter) => filter === raw) ?? ''

const SORT_FIELD_SET: ReadonlySet<string> = new Set(CASE_SORT_FIELDS)
const parseSortField = (raw: string | null): CaseSortField =>
  raw !== null && SORT_FIELD_SET.has(raw) ? (raw as CaseSortField) : 'time'

const parseSortOrder = (raw: string | null): CaseSortOrder =>
  raw === 'desc' ? 'desc' : 'asc'

/**
 * The person column names the reporter, and the publisher in the publisher
 * view, so a sort by it follows the column into the view it lands on.
 */
const sortForView = (
  sort: CaseSortField,
  view: CaseCenterView
): CaseSortField =>
  sort === 'reporter' || sort === 'owner'
    ? isPublisherCaseView(view)
      ? 'owner'
      : 'reporter'
    : sort

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
 * 问题处理. The staff side of the case system plus the broken resource-disk
 * links: its own secondary navigation and queues, living inside the dashboard
 * shell so authentication, the global sidebar and the header are not
 * duplicated. The 待办 views hold everything waiting on the staff; content
 * review (submissions, resources) has its own page.
 */
export function CaseCenter({ initialCaseId }: CaseCenterProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { counts, refreshCounts } = useDashboard()
  const isMobile = useIsMobile()

  const rawView = searchParams.get('view')
  // A `/dashboard/case/[id]` deep link names a case of any status, so it
  // opens on the view that lists every case.
  const view =
    rawView !== null
      ? findCaseView(rawView)
      : initialCaseId !== undefined
        ? findCaseView('all')
        : DEFAULT_CASE_VIEW
  const caseKind = parseCaseKind(searchParams.get('caseKind'))
  const statusFilters = statusFiltersFor(view)
  const caseStatus = parseCaseStatus(
    searchParams.get('caseStatus'),
    statusFilters
  )
  const search = parseSearch(searchParams.get('search'))
  const searchField = parseSearchField(searchParams.get('searchField'))
  const sort = sortForView(parseSortField(searchParams.get('sort')), view)
  const order = parseSortOrder(searchParams.get('order'))
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

  // The broken-link view lists links, not cases; the case list stays on the
  // default queue meanwhile so the navigation badges keep their counts.
  const isBrokenLinks = isBrokenLinkView(view)
  // A status filter stands in for the view's own status parameter; the owner
  // scope stays. Memoized because the list refetches whenever `params` does.
  const viewParams = useMemo<CaseListParams>(() => {
    const keys = view.countKeys
    if (!caseStatus || keys === null) return view.params
    return {
      ...(view.params.ownerType ? { ownerType: view.params.ownerType } : {}),
      statuses: CASE_STATUS_FILTER_STATUSES[caseStatus]
        .filter((status) => keys.includes(status))
        .join(',')
    }
  }, [view, caseStatus])
  const listQuery = {
    params: isBrokenLinks ? DEFAULT_CASE_VIEW.params : viewParams,
    kind: isBrokenLinks ? '' : caseKind,
    search: isBrokenLinks ? '' : search,
    // The field only shapes a submitted search; alone it changes no result.
    searchField: !isBrokenLinks && search ? searchField : 'all',
    sort: isBrokenLinks ? 'time' : sort,
    order: isBrokenLinks ? 'asc' : order,
    ownerId,
    page: isBrokenLinks ? 1 : page,
    limit: QUEUE_PAGE_SIZE
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
        caseStatus?: CaseStatusFilter | ''
        search?: string
        searchField?: CaseSearchField
        sort?: CaseSortField
        order?: CaseSortOrder
        ownerId?: string
        page?: number
        selection?: number | null
      },
      mode: 'push' | 'replace' = 'push'
    ) => {
      const nextView = patch.view ?? view
      const next = {
        view: nextView,
        caseKind: patch.caseKind ?? caseKind,
        caseStatus: patch.caseStatus ?? caseStatus,
        search: patch.search ?? search,
        searchField: patch.searchField ?? searchField,
        sort: sortForView(patch.sort ?? sort, nextView),
        order: patch.order ?? order,
        ownerId: patch.ownerId ?? ownerId,
        page: patch.page ?? page,
        selection: patch.selection === undefined ? selectedId : patch.selection
      }
      const q = new URLSearchParams()
      if (next.view.value !== DEFAULT_CASE_VIEW.value) {
        q.set('view', next.view.value)
      }
      if (next.searchField !== 'all') q.set('searchField', next.searchField)
      if (next.view.countKeys !== null) {
        if (next.caseKind) q.set('caseKind', next.caseKind)
        if (next.caseStatus) q.set('caseStatus', next.caseStatus)
        if (next.search) q.set('search', next.search)
        if (next.ownerId && isPublisherCaseView(next.view)) {
          q.set('owner', next.ownerId)
        }
        if (next.sort !== 'time') q.set('sort', next.sort)
        if (next.order !== 'asc') q.set('order', next.order)
        if (next.page > 1) q.set('page', String(next.page))
        if (next.selection !== null) q.set('id', String(next.selection))
      }
      const query = q.toString()
      const href = query ? `${BASE_PATH}?${query}` : BASE_PATH
      if (mode === 'replace') router.replace(href, { scroll: false })
      else router.push(href, { scroll: false })
    },
    [
      view,
      caseKind,
      caseStatus,
      search,
      searchField,
      sort,
      order,
      ownerId,
      page,
      selectedId,
      router
    ]
  )

  // A filter change is a new result set: back to page 1. The open detail is
  // self-contained and stays open, matching the inbox's outside-window rule.
  // The status filter's groups depend on the view, so a view switch drops it.
  const handleSelectView = (next: CaseCenterView) => {
    navigate({ view: next, caseStatus: '', page: 1 })
  }
  const handleKindChange = (value: string) => {
    navigate({ caseKind: value === ALL_CASE_KINDS ? '' : value, page: 1 })
  }
  const handleCaseStatusChange = (value: string) => {
    navigate({ caseStatus: parseCaseStatus(value, statusFilters), page: 1 })
  }
  // Explorer's column heads: the sorted column flips its direction, another
  // column starts ascending.
  const handleSortChange = (column: CaseSortField) => {
    navigate(
      column === sort
        ? { order: order === 'asc' ? 'desc' : 'asc', page: 1 }
        : { sort: column, order: 'asc', page: 1 }
    )
  }
  const handleOwnerIdChange = (value: string) => {
    navigate({ ownerId: parseOwnerId(value), page: 1 })
  }
  const handleSearchFieldChange = (value: string) => {
    navigate({ searchField: parseSearchField(value), page: 1 })
  }
  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = searchText.trim().slice(0, SEARCH_MAX)
    // Links are not searchable here: run it against every case.
    navigate(
      isBrokenLinks
        ? { view: findCaseView('all'), search: value, page: 1, selection: null }
        : { search: value, page: 1 }
    )
  }
  const handlePageChange = (nextPage: number) => {
    navigate({ page: Math.max(1, nextPage) })
  }
  const handleSelect = (row: AdminCaseListItem) => {
    navigate({ selection: row.id })
  }
  const clearSelection = useCallback(
    () => navigate({ selection: null }),
    [navigate]
  )

  // Hand-edited or shrunk tail page: resolve to the real last page once the
  // standing query reports its total. Never leaves page 1 for an empty filter.
  useEffect(() => {
    if (!list || isBrokenLinks) return
    if (page > 1 && rows.length === 0 && list.total > 0) {
      navigate(
        { page: Math.max(1, Math.ceil(list.total / QUEUE_PAGE_SIZE)) },
        'replace'
      )
    }
  }, [list, isBrokenLinks, page, rows.length, navigate])

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

  // Non-terminal changes (reply): the row's status badge may have changed,
  // and a reply that hands the case to its reporter leaves the inbox's
  // pending count (D23), so the shell counts refresh too.
  const handleStateChanged = useCallback(() => {
    refetch()
    void refreshCounts()
  }, [refetch, refreshCounts])

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

  return (
    <div
      ref={scrollRef}
      aria-label="问题处理"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto md:overflow-hidden"
    >
      <div className="flex min-h-0 min-w-0 flex-1 md:overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2">
            <h2 className="shrink-0 text-sm font-medium whitespace-nowrap">
              {view.label}
            </h2>

            <form
              role="search"
              onSubmit={handleSearchSubmit}
              className="flex min-w-[10rem] flex-1 items-center gap-2"
            >
              <Select
                value={searchField}
                onValueChange={handleSearchFieldChange}
              >
                <SelectTrigger aria-label="搜索范围" className="h-8 w-[7rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CASE_SEARCH_FIELDS.map((field) => (
                    <SelectItem key={field} value={field}>
                      {CASE_SEARCH_FIELD_LABELS[field]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                placeholder={SEARCH_PLACEHOLDERS[searchField]}
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

          {/* One strip at every width: a side column would change the
              list and detail widths whenever a detail opens. */}
          <CaseCenterNav
            current={view}
            statusCounts={navCounts}
            brokenLinkCount={counts ? counts.pending['broken-link'] : null}
            onSelect={handleSelectView}
          />

          {isBrokenLinks ? (
            <BrokenLinkQueue
              isMobile={isMobile}
              onCountChange={() => void refreshCounts()}
            />
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
              statusFilters={statusFilters}
              caseStatus={caseStatus}
              sort={sort}
              order={order}
              ownerId={ownerId}
              searchActive={search.trim().length > 0}
              selectedId={selectedId}
              selectionStatus={selectionStatus}
              isMobile={isMobile}
              onKindChange={handleKindChange}
              onCaseStatusChange={handleCaseStatusChange}
              onSortChange={handleSortChange}
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
