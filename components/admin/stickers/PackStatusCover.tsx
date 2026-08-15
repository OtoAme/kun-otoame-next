import { Avatar, Badge } from '@heroui/react'
import React from 'react'

interface Props {
  name: string
  coverUrl: string | null
  isEnabled: boolean
  compact?: boolean
}

export const PackStatusCover = ({
  name,
  coverUrl,
  isEnabled,
  compact = false
}: Props) => (
  <Badge
    content=""
    isDot
    size="sm"
    color={isEnabled ? 'success' : 'danger'}
    placement="bottom-right"
    role="status"
    aria-label={`${name}${isEnabled ? '已启用' : '已禁用'}`}
    classNames={{
      badge: isEnabled
        ? 'bg-emerald-500 dark:bg-emerald-400'
        : 'bg-red-500 dark:bg-red-400'
    }}
  >
    <Avatar
      showFallback
      radius="sm"
      size={compact ? 'sm' : undefined}
      name={name.slice(0, 1)}
      src={coverUrl ?? undefined}
      className={
        compact ? 'shrink-0 bg-default-100' : 'size-16 shrink-0 bg-default-100'
      }
      classNames={{ img: 'object-contain' }}
    />
  </Badge>
)
