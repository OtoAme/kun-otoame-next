'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { SlidersHorizontal, X } from 'lucide-react'

import {
  DashboardMasterDetail,
  DashboardPage,
  DashboardPagination,
  DashboardPanel
} from '~/components/dashboard/page/DashboardPage'
import {
  Avatar,
  AvatarFallback,
  AvatarImage
} from '~/components/dashboard/ui/avatar'
import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '~/components/dashboard/ui/popover'
import { Checkbox } from '~/components/dashboard/ui/checkbox'
import { Input } from '~/components/dashboard/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import { Skeleton } from '~/components/dashboard/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '~/components/dashboard/ui/table'
import {
  LIST_PAGE_SIZE_OPTIONS,
  useSearchableList,
  type ListFilters,
  type ListSearchType,
  type SearchableListConfig
} from '~/hooks/dashboard/useSearchableList'
import { useElementWidth } from '~/hooks/dashboard/useElementWidth'
import { cn } from '~/lib/dashboard/utils'
import { kunFetchGet } from '~/utils/kunFetch'

const DEBOUNCE_MS = 500
const SKELETON_ROWS = 8

export function UserAvatar({ user }: { user: KunUser }) {
  return (
    <Avatar size="sm">
      {user.avatar && <AvatarImage src={user.avatar} alt="" />}
      <AvatarFallback>{(user.name[0] ?? '?').toUpperCase()}</AvatarFallback>
    </Avatar>
  )
}

/** Searches users by name (the mention search) and picks one. */
export function UserPicker({
  id,
  selected,
  onSelect,
  className = 'w-full sm:w-64'
}: {
  id?: string
  selected: { id: number; name: string } | null
  onSelect: (user: { id: number; name: string } | null) => void
  className?: string
}) {
  const [text, setText] = useState('')
  const [options, setOptions] = useState<KunUser[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const value = text.trim()
    if (!value) {
      setOptions([])
      return
    }
    let active = true
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await kunFetchGet<KunUser[] | string>(
          '/user/mention/search',
          { query: value.slice(0, 20) }
        )
        if (active) setOptions(Array.isArray(res) ? res.slice(0, 10) : [])
      } catch {
        if (active) setOptions([])
      } finally {
        if (active) setLoading(false)
      }
    }, 300)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [text])

  if (selected) {
    return (
      <div
        className={cn(
          'flex h-9 min-w-0 items-center gap-2 rounded-md border px-3 text-sm',
          className
        )}
      >
        <span className="min-w-0 truncate font-medium">{selected.name}</span>
        <span className="text-xs text-muted-foreground">#{selected.id}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="清除用户"
          className="ml-auto"
          onClick={() => onSelect(null)}
        >
          <X />
        </Button>
      </div>
    )
  }

  return (
    <div className={cn('relative', className)}>
      <Input
        id={id}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="输入用户名查找"
        aria-label="查找用户"
        maxLength={20}
      />
      {text.trim() && (
        <ul
          role="listbox"
          aria-label="匹配的用户"
          className="absolute top-full z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {loading ? (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">
              查找中…
            </li>
          ) : options.length === 0 ? (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">
              没有匹配的用户
            </li>
          ) : (
            options.map((user) => (
              <li key={user.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  onClick={() => {
                    setText('')
                    onSelect({ id: user.id, name: user.name })
                  }}
                >
                  <UserAvatar user={user} />
                  {user.name}
                  <span className="ml-auto text-xs text-muted-foreground">
                    #{user.id}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

export interface ListColumn<Row> {
  key: string
  header: string
  /** Shown once the list itself is at least this wide (px). */
  minWidth?: number
  align?: 'right'
  /** Main text column: wraps and takes the remaining width. */
  grow?: boolean
  cell: (row: Row) => ReactNode
}

export interface SearchableListPageProps<Row extends { id: number }> {
  config: SearchableListConfig
  title: string
  description: string
  /** Noun used in counts and labels, e.g. 评论. */
  noun: string
  contentLabel: string
  columns: ListColumn<Row>[]
  /** Compact two-line rendering for very narrow lists. */
  card: (row: Row) => { text: ReactNode; meta: ReactNode }
  detail: (
    row: Row,
    actions: { onUpdated: () => void; onDeleted: (count: number) => void }
  ) => ReactNode
  /** Omitted when the list has no batch action; rows then have no checkbox. */
  batchDelete?: (props: {
    ids: number[]
    onDeleted: (count: number) => void
  }) => ReactNode
  /** False for lists whose API only searches by text. */
  searchByUser?: boolean
  /** For lists the API cannot search at all; filters still apply. */
  hideSearch?: boolean
  /** Extra controls placed after the search box. */
  toolbar?: (ctx: FilterContext) => ReactNode
  /**
   * Page filters. Shown as a left rail when the page is at least 1440px
   * wide, otherwise behind a 筛选 button.
   */
  filterPanel?: (ctx: FilterContext) => ReactNode
  /** Removable summary of the active filters, shown under the toolbar. */
  filterChips?: (filters: ListFilters) => FilterChip[]
}

export interface FilterChip {
  key: string
  label: string
  /** Filters cleared together when the chip is removed; defaults to `key`. */
  keys?: string[]
}

export interface FilterContext {
  /** Whether the list is currently searched by keyword or by author. */
  searchType: ListSearchType
  filters: ListFilters
  setFilters: (patch: Record<string, string>) => void
  clearFilters: () => void
}

export function SearchableListPage<Row extends { id: number }>({
  config,
  title,
  description,
  noun,
  contentLabel,
  columns,
  card,
  detail,
  batchDelete,
  searchByUser = true,
  hideSearch = false,
  toolbar,
  filterPanel,
  filterChips
}: SearchableListPageProps<Row>) {
  const {
    query,
    rows,
    total,
    loading,
    refreshing,
    error,
    refresh,
    setPage,
    setLimit,
    setSearchType,
    commitSearch,
    selectUser,
    select,
    notifyDeleted,
    setFilters,
    clearFilters
  } = useSearchableList<Row>(config)
  const filterContext: FilterContext = {
    searchType: query.searchType,
    filters: query.filters,
    setFilters,
    clearFilters
  }
  // Same width the master-detail layout measures, so the rail and the
  // 筛选 button switch at the same point.
  const [pageRef, pageWidth] = useElementWidth<HTMLDivElement>()
  const showRail = Boolean(filterPanel) && pageWidth >= 1440
  const chips = filterChips?.(query.filters) ?? []

  const [searchInput, setSearchInput] = useState(query.search)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [listRef, listWidth] = useElementWidth<HTMLElement>()
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>())

  // Back/forward or a cleared search resets the input to the URL.
  useEffect(() => {
    setSearchInput(query.search)
  }, [query.search, query.searchType])

  // Checked rows only survive while they are still visible.
  useEffect(() => {
    setChecked((prev) => {
      const visible = new Set(rows.map((row) => row.id))
      const next = new Set([...prev].filter((id) => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [rows])

  useEffect(
    () => () => {
      if (debounceTimer.current !== null) clearTimeout(debounceTimer.current)
    },
    []
  )

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    setSearchInput(value)
    if (debounceTimer.current !== null) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null
      commitSearch(value)
    }, DEBOUNCE_MS)
  }

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current)
      debounceTimer.current = null
    }
    commitSearch(searchInput)
  }

  const selected = rows.find((row) => row.id === query.selected) ?? null

  const handleUpdated = useCallback(() => refresh(), [refresh])
  const handleDeleted = useCallback(
    (count: number) => {
      setChecked(new Set())
      notifyDeleted(count)
    },
    [notifyDeleted]
  )

  const toggle = (id: number, value: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })

  // Arrow keys move the selection through the visible rows.
  const handleRowKey = (
    event: KeyboardEvent<HTMLTableRowElement>,
    index: number
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      select(rows[index].id)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const next =
      rows[
        Math.min(
          rows.length - 1,
          Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1))
        )
      ]
    if (!next) return
    select(next.id)
    rowRefs.current.get(next.id)?.focus()
  }

  useEffect(() => {
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        query.selected !== null &&
        !document.querySelector('[role="dialog"], [role="alertdialog"]')
      ) {
        select(null)
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [query.selected, select])

  const totalPages = Math.max(1, Math.ceil(total / query.limit))
  const allChecked = rows.length > 0 && rows.every((row) => checked.has(row.id))
  // Columns are added as the list gets wider rather than stretched.
  const visibleColumns = columns.filter(
    (column) => !column.minWidth || listWidth >= column.minWidth
  )
  const asCards = listWidth > 0 && listWidth < 480
  const selectable = Boolean(batchDelete)
  const columnCount = visibleColumns.length + Number(selectable)
  const searchLabels: Record<ListSearchType, string> = {
    content: contentLabel,
    user: '用户'
  }

  const list = (
    <DashboardPanel ref={listRef}>
      <div className="flex flex-wrap items-center gap-2 p-3">
        {searchByUser && !hideSearch && (
          <Select
            value={query.searchType}
            onValueChange={(value) => setSearchType(value as ListSearchType)}
          >
            <SelectTrigger className="w-[120px]" aria-label="搜索范围">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(searchLabels) as ListSearchType[]).map((type) => (
                <SelectItem key={type} value={type}>
                  {searchLabels[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {hideSearch ? null : !searchByUser || query.searchType === 'content' ? (
          <form onSubmit={handleSearchSubmit} className="w-full sm:w-64">
            <Input
              value={searchInput}
              onChange={handleSearchChange}
              placeholder={`搜索${contentLabel}，回车立即搜索`}
              aria-label={`搜索${contentLabel}`}
              maxLength={300}
            />
          </form>
        ) : (
          <UserPicker
            selected={
              query.userId === null
                ? null
                : {
                    id: query.userId,
                    name: query.userName || `#${query.userId}`
                  }
            }
            onSelect={selectUser}
          />
        )}
        {toolbar?.(filterContext)}
        {filterPanel && !showRail && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <SlidersHorizontal />
                筛选
                {chips.length > 0 && (
                  <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular-nums">
                    {chips.length}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="max-h-[70svh] w-80 overflow-y-auto"
            >
              {filterPanel(filterContext)}
            </PopoverContent>
          </Popover>
        )}
        <span className="flex-1" />
        {checked.size > 0 && (
          <span className="text-sm text-muted-foreground tabular-nums">
            已选 {checked.size} 条
          </span>
        )}
        {batchDelete?.({ ids: [...checked], onDeleted: handleDeleted })}
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-3">
          {chips.map((chip) => (
            <Badge key={chip.key} variant="secondary" className="gap-1 pr-1">
              {chip.label}
              <button
                type="button"
                aria-label={`移除筛选：${chip.label}`}
                className="rounded-sm p-0.5 hover:bg-background/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                onClick={() =>
                  setFilters(
                    Object.fromEntries(
                      (chip.keys ?? [chip.key]).map((key) => [key, ''])
                    )
                  )
                }
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          <Button
            variant="ghost"
            size="xs"
            onClick={clearFilters}
            className="text-muted-foreground"
          >
            清除全部
          </Button>
        </div>
      )}

      {error !== null ? (
        <div className="flex flex-col items-center gap-3 border-t px-4 py-10">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <Button variant="outline" size="sm" onClick={refresh}>
            重试
          </Button>
        </div>
      ) : asCards ? (
        <ul className="border-t">
          {loading ? (
            Array.from({ length: 4 }).map((_, index) => (
              <li key={index} className="border-b p-3 last:border-b-0">
                <Skeleton className="h-10 w-full" />
              </li>
            ))
          ) : rows.length === 0 ? (
            <li className="p-6 text-center text-sm text-muted-foreground">
              没有{noun}。
            </li>
          ) : (
            rows.map((row) => {
              const content = card(row)
              return (
                <li
                  key={row.id}
                  className="flex gap-3 border-b p-3 last:border-b-0"
                >
                  {selectable && (
                    <Checkbox
                      aria-label={`选择${noun} ${row.id}`}
                      checked={checked.has(row.id)}
                      onCheckedChange={(value) =>
                        toggle(row.id, value === true)
                      }
                      className="mt-1"
                    />
                  )}
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => select(row.id)}
                  >
                    <span className="line-clamp-3 text-sm break-words">
                      {content.text}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {content.meta}
                    </span>
                  </button>
                </li>
              )
            })
          )}
        </ul>
      ) : (
        <div className="border-t">
          <Table>
            <TableHeader>
              <TableRow>
                {selectable && (
                  <TableHead className="w-10 pl-4">
                    <Checkbox
                      aria-label="全选当前页"
                      checked={allChecked}
                      disabled={rows.length === 0}
                      onCheckedChange={(value) =>
                        setChecked(
                          value === true
                            ? new Set(rows.map((row) => row.id))
                            : new Set()
                        )
                      }
                    />
                  </TableHead>
                )}
                {visibleColumns.map((column) => (
                  <TableHead
                    key={column.key}
                    className={cn(column.align === 'right' && 'text-right')}
                  >
                    {column.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: SKELETON_ROWS }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={columnCount}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={columnCount}
                    className="h-32 text-center whitespace-normal text-muted-foreground"
                  >
                    {query.search || query.userId !== null || chips.length > 0
                      ? `没有匹配的${noun}，换个条件再试。`
                      : `还没有${noun}。`}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, index) => (
                  <TableRow
                    key={row.id}
                    ref={(node) => {
                      if (node) rowRefs.current.set(row.id, node)
                      else rowRefs.current.delete(row.id)
                    }}
                    tabIndex={0}
                    aria-selected={row.id === query.selected}
                    data-state={
                      row.id === query.selected ? 'selected' : undefined
                    }
                    onClick={() => select(row.id)}
                    onKeyDown={(event) => handleRowKey(event, index)}
                    className="cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-none data-[state=selected]:shadow-[inset_3px_0_0_var(--primary)]"
                  >
                    {selectable && (
                      <TableCell
                        className="pl-4"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Checkbox
                          aria-label={`选择${noun} ${row.id}`}
                          checked={checked.has(row.id)}
                          onCheckedChange={(value) =>
                            toggle(row.id, value === true)
                          }
                        />
                      </TableCell>
                    )}
                    {visibleColumns.map((column) => (
                      <TableCell
                        key={column.key}
                        className={cn(
                          column.grow && 'max-w-0 min-w-48 whitespace-normal',
                          column.align === 'right' && 'text-right tabular-nums'
                        )}
                      >
                        {column.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <DashboardPagination
        page={query.page}
        totalPages={totalPages}
        total={total}
        unit="条"
        disabled={loading}
        onPageChange={setPage}
      >
        <Select
          value={String(query.limit)}
          onValueChange={(value) => setLimit(Number(value))}
        >
          <SelectTrigger size="sm" className="w-[110px]" aria-label="每页条数">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LIST_PAGE_SIZE_OPTIONS.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {option} 条/页
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </DashboardPagination>
    </DashboardPanel>
  )

  return (
    <DashboardPage
      title={title}
      description={description}
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={loading || refreshing}
        >
          {refreshing ? '刷新中…' : '刷新'}
        </Button>
      }
    >
      <div ref={pageRef} className="min-w-0">
        <DashboardMasterDetail
          rail={showRail ? filterPanel!(filterContext) : undefined}
          list={list}
          detail={
            selected
              ? detail(selected, {
                  onUpdated: handleUpdated,
                  onDeleted: handleDeleted
                })
              : null
          }
          detailTitle={selected ? `${noun} #${selected.id}` : '详情'}
          emptyDetail={
            <p className="text-sm text-muted-foreground">
              选择一条{noun}查看全文与操作。
            </p>
          }
          onCloseDetail={() => select(null)}
        />
      </div>
    </DashboardPage>
  )
}
