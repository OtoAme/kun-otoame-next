'use client'

import { Button, Popover, PopoverContent, PopoverTrigger } from '@heroui/react'
import { LINK_HEALTH_LABELS } from './linkHealthDisplay'
import { LinkHealthStatus } from './LinkHealthStatus'
import type { PatchResourceHealthLink } from '~/types/api/patch'

const isHollowOk = (link: PatchResourceHealthLink) =>
  link.health === 'ok' &&
  (!link.latestCheck || link.latestCheck.failed || !link.latestCheck.checkedAt)

interface Props {
  link: PatchResourceHealthLink
}

export const LinkHealthDot = ({ link }: Props) => {
  const label = LINK_HEALTH_LABELS[link.health]

  return (
    <Popover
      placement="bottom-start"
      classNames={{
        content:
          'max-w-[min(20rem,calc(100vw-1.5rem))] items-start text-left'
      }}
    >
      <PopoverTrigger>
        <Button
          isIconOnly
          size="sm"
          radius="full"
          variant="light"
          disableRipple
          aria-label={`${label}，查看检测详情`}
          className="!size-6 !min-w-0 bg-transparent p-0 text-inherit data-[hover=true]:bg-transparent"
        >
          <span
            className="kun-link-health-dot"
            data-health={link.health}
            {...(isHollowOk(link) ? { 'data-hollow': 'true' } : {})}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <LinkHealthStatus link={link} />
      </PopoverContent>
    </Popover>
  )
}
