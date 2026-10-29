'use client'

import type { ReactNode } from 'react'

import { useElementWidth } from '~/hooks/dashboard/useElementWidth'
import { cn } from '~/lib/dashboard/utils'

// Wide detail panes put the summary beside the preview; narrower ones put a
// one-row summary strip above it.
const SIDE_BY_SIDE_MIN_WIDTH = 1100

export interface ReviewFact {
  label: string
  value: ReactNode
}

/**
 * Review layout for pending submissions and resources. The preview is the
 * only large scroll area and always takes the remaining height; the review
 * form is pinned so its buttons and reason field stay in view while the
 * reviewer reads the preview.
 *
 * - Wide: summary column (account, facts, warnings) beside the preview, the
 *   form pinned under the summary.
 * - Medium: title and a single summary strip on top, preview in the middle,
 *   form pinned at the bottom.
 * - Phone: everything in page flow; the page scrolls as a whole.
 */
export function ReviewLayout({
  title,
  account,
  facts,
  warnings,
  form,
  preview,
  isPhone
}: {
  title: ReactNode
  account: ReactNode
  facts: ReviewFact[]
  /** Duplicate or company warnings; shown only when present. */
  warnings?: ReactNode
  form: ReactNode
  preview: ReactNode
  isPhone: boolean
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const sideBySide = !isPhone && width >= SIDE_BY_SIDE_MIN_WIDTH

  const factList = (inline: boolean) => (
    <dl
      className={cn(
        'min-w-0 text-sm',
        inline
          ? 'flex flex-wrap items-baseline gap-x-5 gap-y-1'
          : 'flex flex-col gap-1.5'
      )}
    >
      {facts.map((fact) => (
        <div
          key={fact.label}
          className={cn(
            'flex min-w-0 items-baseline gap-2',
            !inline && 'w-full'
          )}
        >
          <dt
            className={cn(
              'shrink-0 text-xs text-muted-foreground',
              !inline && 'w-12'
            )}
          >
            {fact.label}
          </dt>
          <dd className="min-w-0 break-words">{fact.value}</dd>
        </div>
      ))}
    </dl>
  )

  if (isPhone) {
    return (
      <div className="flex flex-col gap-4">
        {title}
        {account}
        {factList(false)}
        {warnings}
        <div className="h-[70dvh]">{preview}</div>
        <div className="border-t pt-3">{form}</div>
      </div>
    )
  }

  if (sideBySide) {
    return (
      <div
        ref={ref}
        className="grid h-full min-h-0 grid-cols-[minmax(340px,360px)_minmax(0,1fr)] gap-4"
      >
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
            {title}
            {account}
            {factList(false)}
            {warnings}
          </div>
          <div className="shrink-0 border-t pt-3">{form}</div>
        </div>
        <div className="min-h-0 min-w-0">{preview}</div>
      </div>
    )
  }

  return (
    <div ref={ref} className="flex h-full min-h-0 min-w-0 flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-2">
        {title}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="w-full max-w-64 min-w-0 sm:w-64">{account}</div>
          <div className="min-w-0 flex-1">{factList(true)}</div>
        </div>
        {warnings ? (
          // Warnings can be long; they get a capped area so the preview
          // below keeps most of the height.
          <div className="max-h-40 overflow-y-auto">{warnings}</div>
        ) : null}
      </div>
      <div className="min-h-[240px] flex-1">{preview}</div>
      <div className="shrink-0 border-t pt-3">{form}</div>
    </div>
  )
}
