'use client'

import { CircleHelp } from 'lucide-react'

import { Badge } from '~/components/dashboard/ui/badge'
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '~/components/dashboard/ui/popover'
import { cn } from '~/lib/dashboard/utils'
import type { CaseStatusCounts } from '~/types/api/case'

import {
  CASE_CENTER_VIEWS,
  CASE_VIEW_GROUP_LABELS,
  CASE_VIEW_SCOPE_HINT,
  caseViewCount,
  isBrokenLinkView,
  type CaseCenterView,
  type CaseViewGroup
} from './caseCenterViews'

interface CaseCenterNavProps {
  current: CaseCenterView
  statusCounts: CaseStatusCounts | null
  /** Broken resource-disk links from the shell counts; null until loaded. */
  brokenLinkCount: number | null
  onSelect: (view: CaseCenterView) => void
  className?: string
}

const GROUP_ORDER: CaseViewGroup[] = ['todo', 'browse']

const viewsOf = (group: CaseViewGroup) =>
  CASE_CENTER_VIEWS.filter((view) => view.group === group)

/**
 * Issue-page navigation: one strip of tabs above the list. 待办 entries are
 * disjoint and carry their counts; 查看 entries are read-only or closed
 * lists. A divider separates the two groups.
 */
export function CaseCenterNav({
  current,
  statusCounts,
  brokenLinkCount,
  onSelect,
  className
}: CaseCenterNavProps) {
  const entry = (view: CaseCenterView) => {
    const count = isBrokenLinkView(view)
      ? brokenLinkCount
      : caseViewCount(statusCounts, view)
    const active = view.value === current.value
    return (
      <li key={view.value} className="shrink-0">
        <button
          type="button"
          data-case-view={view.value}
          aria-current={active ? 'page' : undefined}
          onClick={() => onSelect(view)}
          className={cn(
            'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm whitespace-nowrap transition-colors',
            'hover:bg-accent hover:text-accent-foreground',
            'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
            active
              ? 'bg-accent font-medium text-accent-foreground'
              : 'text-muted-foreground'
          )}
        >
          <view.icon className="size-4 shrink-0" aria-hidden />
          <span>{view.label}</span>
          {count !== null && view.group === 'todo' ? (
            <Badge
              variant={count > 0 ? 'default' : 'secondary'}
              className="shrink-0 tabular-nums"
            >
              {count}
            </Badge>
          ) : count !== null ? (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {count}
            </span>
          ) : null}
        </button>
      </li>
    )
  }

  return (
    <nav
      aria-label="问题处理导航"
      data-case-nav="strip"
      className={cn(
        'flex shrink-0 items-center gap-2 border-b px-3 py-1.5',
        className
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
        {GROUP_ORDER.map((group, index) => (
          <ul
            key={group}
            aria-label={CASE_VIEW_GROUP_LABELS[group]}
            className={cn(
              'flex shrink-0 items-center gap-1',
              index > 0 && 'border-l pl-2'
            )}
          >
            {viewsOf(group).map(entry)}
          </ul>
        ))}
      </div>
      <Popover>
        <PopoverTrigger
          aria-label="站方处理哪些问题"
          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <CircleHelp className="size-4" aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 text-xs leading-5">
          <p data-case-scope-hint>{CASE_VIEW_SCOPE_HINT}</p>
        </PopoverContent>
      </Popover>
    </nav>
  )
}
