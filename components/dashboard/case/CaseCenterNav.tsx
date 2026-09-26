'use client'

import { Badge } from '~/components/dashboard/ui/badge'
import { cn } from '~/lib/dashboard/utils'
import type { CaseStatusCounts } from '~/types/api/case'

import {
  CASE_CENTER_VIEWS,
  CASE_VIEW_GROUP_LABELS,
  CASE_VIEW_OVERLAP_HINT,
  caseViewCount,
  type CaseCenterView,
  type CaseViewGroup
} from './caseCenterViews'

interface CaseCenterNavProps {
  current: CaseCenterView
  statusCounts: CaseStatusCounts | null
  orientation: 'vertical' | 'horizontal'
  onSelect: (view: CaseCenterView) => void
  className?: string
}

const GROUP_ORDER: CaseViewGroup[] = [
  'overview',
  'unresolved',
  'closed',
  'all',
  'oversight'
]

const viewsOf = (group: CaseViewGroup) =>
  CASE_CENTER_VIEWS.filter((view) => view.group === group)

/**
 * Case-center navigation. It is a second-level column inside the dashboard
 * shell rather than another global sidebar — the reference mock's left rail
 * lands here, trimmed to the entries module 03 can actually serve.
 *
 * The queue numbers are not mutually exclusive (待处理 and 等待报告者 partition
 * 未结事项; 全部事项 contains everything), so containment is shown rather than
 * left to be inferred: the column indents subsets under their parent, the
 * strip boxes each group, and both state it in words.
 *
 * Rendered twice with complementary visibility. Only one is displayed, so
 * assistive tech reads one set of links.
 */
export function CaseCenterNav({
  current,
  statusCounts,
  orientation,
  onSelect,
  className
}: CaseCenterNavProps) {
  const vertical = orientation === 'vertical'
  const hintId = `case-center-nav-hint-${orientation}`

  const entry = (view: CaseCenterView) => {
    const count = caseViewCount(statusCounts, view)
    const active = view.value === current.value
    return (
      <li key={view.value} className={vertical ? '' : 'shrink-0'}>
        <button
          type="button"
          data-case-view={view.value}
          aria-current={active ? 'page' : undefined}
          onClick={() => onSelect(view)}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm whitespace-nowrap transition-colors',
            'hover:bg-accent hover:text-accent-foreground',
            'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
            active
              ? 'bg-accent font-medium text-accent-foreground'
              : 'text-muted-foreground',
            vertical && view.depth === 1 && 'ml-3 w-[calc(100%-0.75rem)]'
          )}
        >
          <view.icon className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{view.label}</span>
          {count !== null ? (
            <Badge
              variant="secondary"
              className="ml-auto shrink-0 tabular-nums"
            >
              {count}
            </Badge>
          ) : null}
        </button>
      </li>
    )
  }

  return (
    <nav
      aria-label="工单中心导航"
      aria-describedby={hintId}
      data-case-nav={orientation}
      className={cn(
        vertical
          ? 'w-56 shrink-0 space-y-3 overflow-y-auto border-r p-3'
          : 'flex flex-col gap-1 border-b px-3 py-2',
        className
      )}
    >
      {vertical ? (
        GROUP_ORDER.map((group) => (
          <div key={group} className="space-y-1">
            <p className="px-2 text-xs font-semibold text-muted-foreground">
              {CASE_VIEW_GROUP_LABELS[group]}
            </p>
            {/* The indent rail makes the two subsets read as one block. */}
            <ul
              className={cn(
                'space-y-0.5',
                group === 'unresolved' && 'border-l border-transparent'
              )}
            >
              {viewsOf(group).map(entry)}
            </ul>
          </div>
        ))
      ) : (
        <div className="flex items-center gap-2 overflow-x-auto">
          {GROUP_ORDER.map((group) => (
            <ul
              key={group}
              aria-label={CASE_VIEW_GROUP_LABELS[group]}
              className={cn(
                'flex shrink-0 items-center gap-1',
                // Boxing the group is what carries containment sideways,
                // where indentation cannot.
                group === 'unresolved' && 'rounded-md border px-1 py-0.5'
              )}
            >
              {viewsOf(group).map(entry)}
            </ul>
          ))}
        </div>
      )}

      <p
        id={hintId}
        className={cn(
          'text-xs text-muted-foreground',
          vertical ? 'px-2 pt-1' : ''
        )}
      >
        {CASE_VIEW_OVERLAP_HINT}
      </p>
    </nav>
  )
}
