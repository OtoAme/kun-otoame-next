'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ListChecks, RefreshCw, SlidersHorizontal } from 'lucide-react'
import { Button } from '~/components/dashboard/ui/button'
import { Input } from '~/components/dashboard/ui/input'
import { Label } from '~/components/dashboard/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '~/components/dashboard/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import { Tabs, TabsList, TabsTrigger } from '~/components/dashboard/ui/tabs'
import { cn } from '~/lib/dashboard/utils'
import { RESOURCE_SECTION_MAP } from '~/constants/resource'
import type { ListFilters } from '~/hooks/dashboard/useSearchableList'
import type { MergeSort, MergeTab } from '~/types/api/officialMirror'
import { MERGE_TABS, MERGE_PAIR_FILTERS } from '~/types/api/officialMirror'
import {
  MERGE_PAIR_FILTER_LABEL,
  sortLabel,
  sortsForTab,
  TAB_LABEL
} from './mergeDisplay'

const DEBOUNCE_MS = 500
const SEARCH_MAX = 300

export function MergeHeader({
  tab,
  counts,
  filters,
  search,
  batchCount,
  refreshing,
  onSearch,
  onFilters,
  onRefresh,
  onOpenBatch
}: {
  tab: MergeTab
  counts: Record<MergeTab, number> | null
  filters: ListFilters
  search: string
  batchCount: number
  refreshing: boolean
  onSearch: (term: string) => void
  onFilters: (patch: Record<string, string>) => void
  onRefresh: () => void
  onOpenBatch: () => void
}) {
  const [text, setText] = useState(search)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The debounced call runs later; it must use the newest query, not the
  // one of the render that started the timer.
  const searchRef = useRef(onSearch)
  searchRef.current = onSearch
  useEffect(() => setText(search), [search])
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    []
  )

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    onSearch(text)
  }

  const sorts = sortsForTab(tab)
  const sort: MergeSort = sorts.includes(filters.sort as MergeSort)
    ? (filters.sort as MergeSort)
    : sorts[0]
  const activeFilters =
    Number(Boolean(filters.section)) +
    Number(tab === 'pending' && Boolean(filters.pairClass))

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b px-3 py-2 md:px-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="shrink-0 text-base font-semibold">资源合并</h2>
        <Tabs
          value={tab}
          onValueChange={(value) =>
            onFilters({
              tab: value === 'pending' ? '' : value,
              sort: '',
              ...(value === 'pending' ? {} : { pairClass: '' })
            })
          }
        >
          <TabsList>
            {MERGE_TABS.map((item) => (
              <TabsTrigger key={item} value={item}>
                {TAB_LABEL[item]}
                {counts ? (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {counts[item]}
                  </span>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <span className="flex-1" />
        <Button type="button" variant="outline" size="sm" onClick={onOpenBatch}>
          <ListChecks aria-hidden />
          批量合并清单（{batchCount}）
        </Button>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <form
          role="search"
          onSubmit={submit}
          className="flex min-w-[10rem] flex-1 items-center sm:max-w-sm"
        >
          <Input
            type="search"
            value={text}
            maxLength={SEARCH_MAX}
            aria-label="搜索游戏或资源"
            placeholder="搜索游戏或资源，回车立即搜索"
            className="h-8"
            onChange={(event) => {
              const value = event.target.value
              setText(value)
              if (timer.current !== null) clearTimeout(timer.current)
              timer.current = setTimeout(() => {
                timer.current = null
                searchRef.current(value)
              }, DEBOUNCE_MS)
            }}
          />
        </form>
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <SlidersHorizontal aria-hidden />
              筛选
              {activeFilters > 0 ? (
                <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular-nums">
                  {activeFilters}
                </span>
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="merge-filter-section">分区</Label>
                <Select
                  value={filters.section ?? 'all'}
                  onValueChange={(value) =>
                    onFilters({ section: value === 'all' ? '' : value })
                  }
                >
                  <SelectTrigger id="merge-filter-section" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部分区</SelectItem>
                    {Object.entries(RESOURCE_SECTION_MAP).map(
                      ([key, label]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
              {tab === 'pending' ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="merge-filter-class">配对</Label>
                  <Select
                    value={filters.pairClass ?? 'all'}
                    onValueChange={(value) =>
                      onFilters({ pairClass: value === 'all' ? '' : value })
                    }
                  >
                    <SelectTrigger id="merge-filter-class" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部配对</SelectItem>
                      {MERGE_PAIR_FILTERS.map((item) => (
                        <SelectItem key={item} value={item}>
                          {MERGE_PAIR_FILTER_LABEL[item]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {activeFilters > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-fit text-muted-foreground"
                  onClick={() => onFilters({ section: '', pairClass: '' })}
                >
                  清除筛选
                </Button>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>
        <Select
          value={sort}
          onValueChange={(value) =>
            onFilters({ sort: value === sorts[0] ? '' : value })
          }
        >
          <SelectTrigger size="sm" aria-label="排序" className="w-[9.5rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sorts.map((item) => (
              <SelectItem key={item} value={item}>
                {sortLabel(tab, item)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshCw
            aria-hidden
            className={cn(
              'size-4',
              refreshing && 'animate-spin motion-reduce:animate-none'
            )}
          />
          刷新
        </Button>
      </div>
    </div>
  )
}
