'use client'

import Link from 'next/link'
import { KunAvatar } from '~/components/kun/floating-card/KunAvatar'
import { cn } from '~/utils/cn'
import type { HelpUser } from '~/types/api/help'

interface Props {
  user: HelpUser | null
  /** Avatar size; `none` renders the name only. */
  avatar?: 'sm' | 'xs' | 'none'
  className?: string
  nameClassName?: string
}

/**
 * Avatar and name of a help author. Both open the user's profile page, the
 * same target as KunAvatar elsewhere on the site; a deleted account shows a plain label without a link.
 */
export const HelpUserLink = ({
  user,
  avatar = 'sm',
  className,
  nameClassName
}: Props) => {
  if (!user) {
    return <span className={cn('text-default-500', className)}>已注销用户</span>
  }
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      {avatar !== 'none' && (
        <KunAvatar
          uid={user.id}
          avatarProps={{
            name: user.name,
            src: user.avatar,
            showFallback: true,
            size: 'sm',
            classNames:
              avatar === 'xs' ? { base: 'size-6 text-tiny' } : undefined
          }}
        />
      )}
      <Link
        href={`/user/${user.id}/comment`}
        className={cn(
          'truncate hover:text-primary hover:underline',
          nameClassName
        )}
        onClick={(event) => event.stopPropagation()}
      >
        {user.name}
      </Link>
    </span>
  )
}
