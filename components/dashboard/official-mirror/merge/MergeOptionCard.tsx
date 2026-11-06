'use client'

import { PreviewFrame } from '~/components/dashboard/inbox/PreviewFrame'
import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import { cn } from '~/lib/dashboard/utils'
import type { MergeOption } from '~/types/api/officialMirror'
import {
  blockedReasons,
  cardName,
  sectionLabel,
  showTime,
  signalText,
  userCardSrc
} from './mergeDisplay'

/** One staff card of the game: its public card, then the match strip. */
export function MergeOptionCard({
  option,
  current,
  readOnly,
  selectable,
  onSelect
}: {
  option: MergeOption
  current: boolean
  /** The merged tab: no current pair to show or change. */
  readOnly: boolean
  /** False while a load or write is in flight. */
  selectable: boolean
  onSelect: (staffResourceId: number) => void
}) {
  const staff = option.staff
  return (
    <article
      aria-label={`官方资源 #${staff.id}`}
      data-merge-option={staff.id}
      data-current={current && !readOnly ? 'true' : undefined}
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-lg border p-3',
        current &&
          !readOnly &&
          'border-primary shadow-[inset_3px_0_0_var(--primary)]'
      )}
    >
      <PreviewFrame
        lazy
        src={userCardSrc(staff.id)}
        title={`官方资源 #${staff.id} 预览`}
      />
      <div className="flex min-w-0 flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {readOnly ? null : current ? (
            <Badge>当前配对</Badge>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!selectable}
              onClick={() => onSelect(staff.id)}
            >
              设为当前配对
            </Button>
          )}
          {option.recommended ? <Badge variant="secondary">推荐</Badge> : null}
          {option.highConfidence ? (
            <Badge variant="secondary">高置信 · 可批量合并</Badge>
          ) : null}
          {option.record === 'dismissed' ? (
            <Badge variant="outline">已驳回</Badge>
          ) : null}
          {!option.sameSection ? (
            <Badge variant="outline">{sectionLabel(staff.section)}</Badge>
          ) : null}
        </div>
        <p className="font-medium break-words">
          #{staff.id} {cardName(staff.name)}
        </p>
        <p className="text-xs break-words text-muted-foreground">
          {staff.publisher?.name || '—'} · 获取次数 {staff.download} · 发布于{' '}
          {showTime(staff.created)}
        </p>
        {option.signals.length > 0 ? (
          <ul
            aria-label={`#${staff.id} 的匹配项`}
            className="flex flex-wrap gap-x-3 gap-y-1"
          >
            {option.signals.map((check) => (
              <li
                key={check.signal}
                data-signal={check.signal}
                data-hit={check.hit ? 'true' : 'false'}
                className={cn(
                  'min-w-0 font-medium break-words',
                  check.hit
                    ? 'text-green-700 dark:text-green-400'
                    : 'text-destructive'
                )}
              >
                {signalText(check)}
              </li>
            ))}
          </ul>
        ) : null}
        {!option.mergeable ? (
          <ul className="flex flex-col gap-1 text-muted-foreground">
            {blockedReasons(option).map((reason) => (
              <li key={reason} className="break-words">
                {reason}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  )
}
