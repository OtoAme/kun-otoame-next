'use client'

import { Badge } from '~/components/dashboard/ui/badge'
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
  orientation: 'vertical' | 'horizontal'
  onSelect: (view: CaseCenterView) => void
  className?: string
}

const GROUP_ORDER: CaseViewGroup[] = ['todo', 'browse']

const viewsOf = (group: CaseViewGroup) =>
  CASE_CENTER_VIEWS.filter((view) => view.group === group)

/**
 * Issue-page navigation: a second-level column inside the dashboard shell.
 * 待办 entries are disjoint and each carries its count; 查看 entries are
 * read-only or closed lists.
 *
 * Rendered twice with complementary visibility. Only one is displayed, so
 * assistive tech reads one set of links.
 */
export function CaseCenterNav({
  current,
  statusCounts,
  brokenLinkCount,
  orientation,
  onSelect,
  className
}: CaseCenterNavProps) {
  const vertical = orientation === 'vertical'
  const hintId = `case-center-nav-hint-${orientation}`

  const entry = (view: CaseCenterView) => {
    const count = isBrokenLinkView(view)
      ? brokenLinkCount
      : caseViewCount(statusCounts, view)
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
              : 'text-muted-foreground'
          )}
        >
          <view.icon className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{view.label}</span>
          {count !== null && view.group === 'todo' ? (
            <Badge
              variant={count > 0 ? 'default' : 'secondary'}
              className="ml-auto shrink-0 tabular-nums"
            >
              {count}
            </Badge>
          ) : count !== null ? (
            <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
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
      aria-describedby={hintId}
      data-case-nav={orientation}
      className={cn(
        vertical
          ? 'w-52 shrink-0 space-y-4 overflow-y-auto border-r p-3'
          : 'flex flex-col gap-1 border-b px-3 py-2',
        className
      )}
    >
      {vertical ? (
        GROUP_ORDER.map((group) => {
          const titleId = `case-center-nav-group-${group}`
          return (
            <div key={group} className="space-y-1">
              <p
                id={titleId}
                className="px-2 text-xs font-semibold text-muted-foreground"
              >
                {CASE_VIEW_GROUP_LABELS[group]}
              </p>
              <ul aria-labelledby={titleId} className="space-y-0.5">
                {viewsOf(group).map(entry)}
              </ul>
            </div>
          )
        })
      ) : (
        <div className="flex items-center gap-3 overflow-x-auto">
          {GROUP_ORDER.map((group) => (
            <ul
              key={group}
              aria-label={CASE_VIEW_GROUP_LABELS[group]}
              className="flex shrink-0 items-center gap-1"
            >
              {viewsOf(group).map(entry)}
            </ul>
          ))}
        </div>
      )}

      <p
        id={hintId}
        className={cn(
          'text-xs leading-5 text-muted-foreground',
          vertical ? 'px-2 pt-1' : 'sr-only'
        )}
      >
        {CASE_VIEW_SCOPE_HINT}
      </p>
    </nav>
  )
}
