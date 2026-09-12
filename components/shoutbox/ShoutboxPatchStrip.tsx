'use client'

import Link from 'next/link'
import { Button } from '@heroui/button'
import { Card, CardBody } from '@heroui/card'
import { ChevronRight, Megaphone } from 'lucide-react'
import { useShoutboxFeed } from '~/hooks/useShoutboxFeed'
import { SHOUTBOX_PATCH_STRIP_TITLE } from '~/constants/shoutbox'
import { ShoutboxCompactRow } from '../shoutbox/ShoutboxCompactRow'

interface Props {
  patchUniqueId: string
}

/**
 * Compact per-game strip on the patch page header: latest 3 messages linked
 * to this game plus a "more" entry into the per-game shoutbox view. Hidden
 * while loading, on error (it retries by itself) and when there is nothing
 * to show, so the game page layout never shifts around a widget.
 */
export const ShoutboxPatchStrip = ({ patchUniqueId }: Props) => {
  const { data, loading } = useShoutboxFeed({ patch: patchUniqueId })
  const rows = (data?.shoutboxes ?? []).slice(0, 3)

  if ((loading && !data) || rows.length === 0) {
    return null
  }

  return (
    <Card
      shadow="none"
      className="mt-4 border border-default-200"
      aria-label="关联小喇叭"
    >
      <CardBody className="gap-2 p-3">
        <div className="flex items-center gap-2">
          <Megaphone className="size-4 text-primary" aria-hidden />
          <h2 className="text-sm font-bold">{SHOUTBOX_PATCH_STRIP_TITLE}</h2>
          <Button
            as={Link}
            href={`/shoutbox?patch=${patchUniqueId}`}
            size="sm"
            variant="light"
            color="primary"
            className="ml-auto"
            endContent={<ChevronRight className="size-3.5" />}
          >
            更多
          </Button>
        </div>
        {rows.map((item) => (
          <ShoutboxCompactRow key={item.id} item={item} />
        ))}
      </CardBody>
    </Card>
  )
}
