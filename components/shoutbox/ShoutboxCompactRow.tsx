'use client'

import Link from 'next/link'
import { Avatar } from '@heroui/avatar'
import { Card, CardBody } from '@heroui/card'
import { Chip } from '@heroui/chip'
import { useMounted } from '~/hooks/useMounted'
import { cn } from '~/utils/cn'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import { formatTimeDifference } from '~/utils/time'
import { ShoutboxReportButton } from './ShoutboxReportButton'
import type { ShoutboxItem } from '~/types/api/shoutbox'

interface Props {
  item: ShoutboxItem
  pinned?: boolean
}

/**
 * Read-only compact row for the home module and the per-game strip. Author
 * actions (edit/delete) live on the full card used by the shoutbox pages.
 */
export const ShoutboxCompactRow = ({ item, pinned = false }: Props) => {
  // Deterministic Asia/Shanghai text for SSR and first hydration; the
  // relative label only replaces it after mount.
  const mounted = useMounted()

  return (
    <Card
      shadow="none"
      className={cn(
        'w-full border border-default-200',
        item.official && 'border-primary-300 bg-primary-50'
      )}
    >
      <CardBody className="flex-row items-start gap-2 px-3 py-2">
        <Avatar
          src={item.user.avatar}
          name={item.user.name}
          size="sm"
          className="mt-0.5 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={`/user/${item.user.id}`}
              className="text-xs font-medium hover:underline"
            >
              {item.user.name}
            </Link>
            {item.official && (
              <Chip size="sm" color="primary" variant="flat">
                官方
              </Chip>
            )}
            {item.official && item.level === 'important' && (
              <Chip size="sm" color="warning" variant="flat">
                重要
              </Chip>
            )}
            {pinned && (
              <Chip size="sm" color="primary" variant="bordered">
                置顶
              </Chip>
            )}
            <time
              dateTime={item.created}
              className="ml-auto shrink-0 text-xs text-default-400"
            >
              {mounted
                ? formatTimeDifference(item.created)
                : formatChinaDateTime(item.created)}
            </time>
          </div>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">
            {item.content}
          </p>
          <div className="flex flex-wrap items-center gap-x-3">
            {item.patch && (
              <Link
                href={`/${item.patch.uniqueId}`}
                className="max-w-full truncate text-xs text-primary hover:underline"
              >
                《{item.patch.name}》
              </Link>
            )}
            {item.link ? (
              <Link
                href={item.link}
                className="text-xs text-primary hover:underline"
              >
                查看详情
              </Link>
            ) : null}
            <span className="ml-auto">
              <ShoutboxReportButton
                shoutboxId={item.id}
                authorId={item.user.id}
              />
            </span>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}
