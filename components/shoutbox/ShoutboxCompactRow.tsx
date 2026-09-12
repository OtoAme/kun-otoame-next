'use client'

import Link from 'next/link'
import { Avatar } from '@heroui/avatar'
import { Chip } from '@heroui/chip'
import { Gamepad2 } from 'lucide-react'
import { getShoutboxStatusLabel } from '~/constants/shoutbox'
import { useMounted } from '~/hooks/useMounted'
import { cn } from '~/utils/cn'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import { normalizeShoutboxContent } from '~/utils/shoutboxContent'
import { formatTimeDifference } from '~/utils/time'
import { ShoutboxReportButton } from './ShoutboxReportButton'
import type { ReactNode } from 'react'
import type { ShoutboxItem } from '~/types/api/shoutbox'

interface Props {
  item: ShoutboxItem
  pinned?: boolean
  actions?: ReactNode
  /** Author record page: also render the status label and the 已编辑 marker after the body. */
  showStatus?: boolean
  /**
   * View-level reserve for the action area: views that allow delete (the
   * list pages) reserve two 32px slots, the others (home, per-game strip)
   * reserve one. Per-message button visibility never changes the reserved
   * width, so the text column and the time sit identically on every row.
   */
  allowsDelete?: boolean
}

export const ShoutboxCompactRow = ({
  item,
  pinned = false,
  actions,
  showStatus = false,
  allowsDelete = false
}: Props) => {
  const mounted = useMounted()

  return (
    <div
      className={cn(
        // Three columns: avatar / text / actions+time. Below sm the text
        // wrapper is display:contents: its header (badges, author, colon)
        // takes row 1 next to the avatar and the content always starts on
        // row 2, spanning the text and action columns — never under the
        // avatar. From sm up the wrapper is one inline flow in the middle
        // column, whose track always excludes the action column.
        // min-h-10 keeps short single-line rows at a consistent height;
        // content-center centers the 28px first-line track in the 32px
        // content box of such rows, and is inert once the body wraps
        // taller — the avatar and actions stay anchored to the first line.
        'grid min-h-10 grid-cols-[auto_minmax(0,1fr)_auto] items-start content-center gap-x-1 rounded-lg px-2 py-1',
        item.official && 'bg-primary-50'
      )}
    >
      <Avatar
        src={item.user.avatar}
        name={item.user.name}
        size="sm"
        className="h-7 w-7 shrink-0"
      />
      {/* Both ends share the 24px line-height (mobile 14/24, PC 16/24); on
          PC (where the wrapper is the block middle column) sm:pt-0.5 drops
          the 24px first text line by 2px so its center matches the 28px
          avatar/action row. Inline chips center on the line box, not the
          font's x-height: align-top puts the 20px chip at the line-box top
          and top-0.5 adds the (24-20)/2 offset. Mobile badges are flex
          items, so their offset stays sm-only. */}
      <div className="contents min-w-0 text-small leading-6 sm:block sm:pt-0.5 sm:text-base sm:leading-6">
        {/* Mobile: one 28px header line — badges cannot shrink, an overlong
            author name truncates in the leftover width (full name in title).
            Desktop: display:contents, so everything joins the text flow. */}
        <span className="flex h-7 min-w-0 items-center sm:contents">
          {pinned && (
            <Chip
              size="sm"
              color="primary"
              variant="bordered"
              className="mr-1 shrink-0 sm:relative sm:top-0.5 sm:align-top"
              classNames={{
                base: 'max-sm:mr-0.5 max-sm:px-0.5 sm:h-5',
                content: 'max-sm:px-0'
              }}
            >
              置顶
            </Chip>
          )}
          {item.official && item.level === 'important' && (
            <Chip
              size="sm"
              color="danger"
              variant="bordered"
              className="mr-1 shrink-0 sm:relative sm:top-0.5 sm:align-top"
              classNames={{
                base: 'max-sm:mr-0.5 max-sm:px-0.5 sm:h-5',
                content: 'max-sm:px-0'
              }}
            >
              重要
            </Chip>
          )}
          <Link
            href={`/user/${item.user.id}`}
            title={item.user.name}
            className="font-bold hover:underline max-sm:min-w-0 max-sm:truncate"
          >
            {item.user.name}
          </Link>
          <span className="shrink-0">：</span>
        </span>
        <span className="max-sm:col-start-2 max-sm:col-span-2 max-sm:row-start-2 sm:contents">
          <span className="whitespace-pre-wrap break-words">
            {normalizeShoutboxContent(item.content)}
          </span>
          {item.patch && (
            <>
              {' '}
              {/* Keep the inline capsule within the 24px body line. */}
              <Chip
                as={Link}
                href={`/${item.patch.uniqueId}`}
                size="sm"
                color="primary"
                variant="flat"
                title={item.patch.name}
                startContent={
                  <Gamepad2 className="size-3.5 shrink-0" aria-hidden />
                }
                classNames={{
                  base: 'h-5 min-w-0 max-w-[min(12rem,100%)] px-2 align-top relative top-0.5 text-sm',
                  content: 'truncate'
                }}
              >
                {item.patch.name}
              </Chip>
            </>
          )}
          {item.link ? (
            <>
              {' '}
              <Link
                href={item.link}
                className="text-xs text-primary hover:underline"
              >
                查看详情
              </Link>
            </>
          ) : null}
        </span>
        {showStatus && (item.status !== 0 || item.editedAt) && (
          // Author record page only: wraps on its own mobile row in the text
          // column — never under the avatar or the fixed time column; on PC
          // it joins the middle column's inline flow right after the body.
          <span className="max-sm:col-start-2 max-sm:row-start-3 sm:contents">
            {item.status !== 0 && (
              <>
                {' '}
                <Chip
                  size="sm"
                  variant="flat"
                  color={
                    item.status === 3
                      ? 'danger'
                      : item.status === 2
                        ? 'warning'
                        : 'default'
                  }
                  className="mr-1 align-top relative top-0.5"
                  classNames={{ base: 'h-5' }}
                >
                  {getShoutboxStatusLabel(item.status, item.official)}
                </Chip>
              </>
            )}
            {item.editedAt && (
              <>
                {' '}
                <span className="text-xs text-default-400">已编辑</span>
              </>
            )}
          </span>
        )}
      </div>
      {/* First-line-aligned action column: the reserved slot width stays
          view-based (allowsDelete) and empty slots never collapse; the 64px
          time hugs the slots with a 2px gap, stays empty before mount (SSR
          would print a long absolute date), full time in title/dateTime. */}
      <div className="flex h-7 items-center gap-0.5">
        <div
          className={cn(
            'flex items-center justify-end',
            allowsDelete ? 'w-16' : 'w-8'
          )}
        >
          {actions}
          <ShoutboxReportButton
            shoutboxId={item.id}
            authorId={item.user.id}
            reportable={item.reportable}
            isIconOnly
          />
        </div>
        <time
          dateTime={item.created}
          title={formatChinaDateTime(item.created)}
          className="w-16 shrink-0 whitespace-nowrap text-left text-xs leading-7 tabular-nums text-default-400"
        >
          {mounted ? formatTimeDifference(item.created) : ''}
        </time>
      </div>
    </div>
  )
}
