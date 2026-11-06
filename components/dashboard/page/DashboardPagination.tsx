'use client'

import {
  useEffect,
  useId,
  useState,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '~/components/dashboard/ui/button'
import { Input } from '~/components/dashboard/ui/input'
import { cn } from '~/lib/dashboard/utils'

function parsePageInput(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) && value >= 1 ? value : null
}

export function DashboardPagination({
  page,
  totalPages,
  total,
  unit,
  disabled,
  onPageChange,
  children,
  className
}: {
  page: number
  totalPages: number
  total?: number
  unit?: string
  disabled?: boolean
  onPageChange: (page: number) => void
  /** Extra controls such as a page-size select. */
  children?: ReactNode
  className?: string
}) {
  const pages = Math.max(1, totalPages)
  const pagesId = useId()
  const [draft, setDraft] = useState(String(page))

  useEffect(() => {
    setDraft(String(page))
  }, [page])

  const goTo = (next: number) => {
    const clamped = Math.min(pages, Math.max(1, next))
    setDraft(String(clamped))
    if (clamped !== page) onPageChange(clamped)
  }

  const commitDraft = () => {
    const parsed = parsePageInput(draft)
    if (parsed === null) {
      setDraft(String(page))
      return
    }
    goTo(parsed)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitDraft()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setDraft(String(page))
      event.currentTarget.blur()
    }
  }

  return (
    <div
      className={cn(
        'flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t bg-card px-3 py-2.5 text-sm text-muted-foreground',
        className
      )}
    >
      {typeof total === 'number' ? (
        <span className="tabular-nums">
          共 {total}
          {unit ? ` ${unit}` : ''}
        </span>
      ) : null}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {children}
        <div
          data-page-nav
          className="flex shrink-0 flex-nowrap items-center gap-1"
        >
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="上一页"
            disabled={disabled || page <= 1}
            onClick={() => goTo(page - 1)}
          >
            <ChevronLeft />
          </Button>
          <Input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            aria-label="页码"
            aria-describedby={pagesId}
            disabled={disabled}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitDraft}
            onKeyDown={handleKeyDown}
            className="h-8 w-12 px-1 text-center text-sm tabular-nums md:text-sm"
          />
          <span id={pagesId} className="px-0.5 tabular-nums">
            / {pages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="下一页"
            disabled={disabled || page >= pages}
            onClick={() => goTo(page + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  )
}
