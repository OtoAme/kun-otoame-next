'use client'

import { type ReactNode, type Ref } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, X } from 'lucide-react'

import { Button } from '~/components/dashboard/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '~/components/dashboard/ui/sheet'
import { useElementWidth } from '~/hooks/dashboard/useElementWidth'
import { cn } from '~/lib/dashboard/utils'

/**
 * Shared page skeleton for console list pages (redesign requirement 3.5).
 *
 * Layout follows the width of the area the page is given:
 * - below 768px the list fills the page and a selected item replaces it;
 * - 768–1023px the detail opens as a right-hand sheet;
 * - from 1024px list and detail sit side by side;
 * - from 1440px an optional filter rail appears on the left.
 */
export function DashboardPage({
  title,
  description,
  actions,
  children
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="flex min-w-0 flex-col gap-4 px-4 py-4 md:px-6 md:py-5">
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold md:text-xl">{title}</h2>
            {description && (
              <p className="mt-1 text-sm text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {actions && (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}

/**
 * Header-only frame for pages that manage their own scrolling and padding
 * (the pages built before the shared skeleton). It adds the same title and
 * description block and leaves the page body untouched.
 */
export function DashboardPageHeader({
  title,
  description,
  children
}: {
  title: string
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="shrink-0 px-4 pt-4 md:px-6 md:pt-5">
        <h2 className="text-lg font-semibold md:text-xl">{title}</h2>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:px-2">
        {children}
      </div>
    </div>
  )
}

export function DashboardPanel({
  className,
  children,
  ref
}: {
  className?: string
  children: ReactNode
  ref?: Ref<HTMLElement>
}) {
  return (
    <section
      ref={ref}
      className={cn(
        'min-w-0 rounded-xl border bg-card text-card-foreground shadow-xs',
        className
      )}
    >
      {children}
    </section>
  )
}

interface MasterDetailProps {
  /** Optional filters; shown as a left rail from 1440px, otherwise omitted. */
  rail?: ReactNode
  list: ReactNode
  /** Detail body for the selected item, or null when nothing is selected. */
  detail: ReactNode | null
  detailTitle: string
  emptyDetail: ReactNode
  onCloseDetail: () => void
}

export function DashboardMasterDetail({
  rail,
  list,
  detail,
  detailTitle,
  emptyDetail,
  onCloseDetail
}: MasterDetailProps) {
  const [ref, width] = useElementWidth<HTMLElement>()
  const isNarrow = width < 768
  const isSplit = width >= 1024
  const showRail = Boolean(rail) && width >= 1440
  const hasDetail = detail !== null

  if (isNarrow && hasDetail) {
    return (
      <DashboardPanel ref={ref}>
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Button variant="ghost" size="sm" onClick={onCloseDetail}>
            <ArrowLeft />
            返回列表
          </Button>
          <h3 className="min-w-0 truncate text-sm font-medium">
            {detailTitle}
          </h3>
        </div>
        <div className="p-4">{detail}</div>
      </DashboardPanel>
    )
  }

  return (
    <div
      ref={ref}
      className={cn(
        'grid min-w-0 items-start gap-4',
        showRail
          ? 'grid-cols-[220px_minmax(0,1.45fr)_minmax(360px,1fr)]'
          : isSplit && 'grid-cols-[minmax(0,1.3fr)_minmax(320px,1fr)]'
      )}
    >
      {showRail && <DashboardPanel className="p-4">{rail}</DashboardPanel>}
      {list}
      {isSplit ? (
        <DashboardPanel className="sticky top-0">
          <div className="flex min-h-12 items-center gap-2 border-b px-4 py-2">
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
              {hasDetail ? detailTitle : '详情'}
            </h3>
            {hasDetail && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="关闭详情"
                onClick={onCloseDetail}
              >
                <X />
              </Button>
            )}
          </div>
          <div className="p-4">{hasDetail ? detail : emptyDetail}</div>
        </DashboardPanel>
      ) : (
        !isNarrow && (
          <Sheet
            open={hasDetail}
            onOpenChange={(open) => {
              if (!open) onCloseDetail()
            }}
          >
            <SheetContent className="w-full overflow-y-auto sm:max-w-md">
              <SheetHeader>
                <SheetTitle>{detailTitle}</SheetTitle>
                <SheetDescription className="sr-only">
                  所选项目的详情与操作
                </SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-4">{detail}</div>
            </SheetContent>
          </Sheet>
        )
      )}
    </div>
  )
}

export function DashboardPagination({
  page,
  totalPages,
  total,
  unit,
  disabled,
  onPageChange,
  children
}: {
  page: number
  totalPages: number
  total: number
  unit: string
  disabled?: boolean
  onPageChange: (page: number) => void
  /** Extra controls such as a page-size select. */
  children?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2.5 text-sm text-muted-foreground">
      <span className="tabular-nums">
        共 {total} {unit} · 第 {page} / {totalPages} 页
      </span>
      <span className="flex-1" />
      {children}
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="上一页"
        disabled={disabled || page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeft />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="下一页"
        disabled={disabled || page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        <ChevronRight />
      </Button>
    </div>
  )
}
