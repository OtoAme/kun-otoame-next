'use client'

import Link from 'next/link'
import { Alert } from '@heroui/alert'
import { Button } from '@heroui/button'
import { Card, CardBody } from '@heroui/card'
import { Spinner } from '@heroui/spinner'
import { ChevronRight, Megaphone } from 'lucide-react'
import { useShoutboxFeed } from '~/hooks/useShoutboxFeed'
import { useUserStore } from '~/store/userStore'
import { SHOUTBOX_PATCH_STRIP_TITLE } from '~/constants/shoutbox'
import { ShoutboxCard } from '../shoutbox/ShoutboxCard'

interface Props {
  patchUniqueId: string
}

/**
 * Compact per-game strip on the patch page header: latest 3 messages linked
 * to this game plus a "more" entry into the per-game shoutbox view. The
 * first load shows a spinner, a failed first read offers a retry, and a
 * failed background refresh keeps the rows with a slim notice; a successful
 * empty payload takes no space on the page at all.
 */
export const ShoutboxPatchStrip = ({ patchUniqueId }: Props) => {
  const { data, loading, error, retry } = useShoutboxFeed({
    patch: patchUniqueId
  })
  const currentUserId = useUserStore((state) => state.user.uid)
  const rows = (data?.shoutboxes ?? []).slice(0, 3)

  if (loading && !data) {
    return (
      <Card
        shadow="none"
        className="mt-4 border border-default-200"
        aria-label="关联小喇叭"
      >
        <CardBody className="items-center p-3">
          <Spinner variant="default" size="sm" color="primary" />
        </CardBody>
      </Card>
    )
  }

  if (error && !data) {
    return (
      <Card
        shadow="none"
        className="mt-4 border border-default-200"
        aria-label="关联小喇叭"
      >
        <CardBody className="p-3">
          <Alert
            color="danger"
            variant="flat"
            description={error}
            endContent={
              <Button size="sm" variant="light" color="danger" onPress={retry}>
                重试
              </Button>
            }
          />
        </CardBody>
      </Card>
    )
  }

  if (rows.length === 0) {
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
        {error !== '' && (
          <Alert
            color="warning"
            variant="flat"
            description={error}
            endContent={
              <Button size="sm" variant="light" color="warning" onPress={retry}>
                重试
              </Button>
            }
          />
        )}
        {rows.map((item) => (
          <ShoutboxCard
            key={item.id}
            item={item}
            compact
            showDelete={false}
            currentUserId={currentUserId}
          />
        ))}
      </CardBody>
    </Card>
  )
}
