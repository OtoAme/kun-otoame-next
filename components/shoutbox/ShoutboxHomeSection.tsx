'use client'

import Link from 'next/link'
import { Alert } from '@heroui/alert'
import { Button } from '@heroui/button'
import { Card, CardBody, CardHeader } from '@heroui/card'
import { Chip } from '@heroui/chip'
import { useDisclosure } from '@heroui/modal'
import { ScrollShadow } from '@heroui/scroll-shadow'
import { Spinner } from '@heroui/spinner'
import { ChevronRight, Megaphone } from 'lucide-react'
import { SHOUTBOX_HOME_LIMIT, SHOUTBOX_PRICE } from '~/constants/shoutbox'
import { useShoutboxFeed } from '~/hooks/useShoutboxFeed'
import { useUserStore } from '~/store/userStore'
import { cn } from '~/utils/cn'
import { ShoutboxCard } from './ShoutboxCard'
import {
  ShoutboxLoginModal,
  ShoutboxPublishModal
} from './ShoutboxPublishModal'

// HomeHero has a 300px minimum height; cap this entire card at the same size.
export const ShoutboxHomeSection = () => {
  const { data, loading, error, retry } = useShoutboxFeed({ home: true })
  const publishModal = useDisclosure()
  const loginModal = useDisclosure()
  const currentUserId = useUserStore((state) => state.user.uid)

  const pinned = data?.pinned ?? null
  // The pinned official message occupies one of the home slots; bound the
  // ordinary rows so the module can never render more than the home limit
  // even if a malformed response carries extra rows alongside a pinned one.
  const rows = (data?.shoutboxes ?? []).slice(
    0,
    pinned ? SHOUTBOX_HOME_LIMIT - 1 : SHOUTBOX_HOME_LIMIT
  )
  // Only the home response carries hasMore; a response without the field
  // (older payloads, the generic list shape) behaves as "no more".
  const hasMore = Boolean(data && 'hasMore' in data && data.hasMore === true)
  const initialLoading = loading && !data

  const handleClickPublish = () => {
    if (currentUserId > 0) {
      publishModal.onOpen()
    } else {
      loginModal.onOpen()
    }
  }

  const handlePublished = () => {
    // The publish form already invalidated and refetched the observed public
    // keys through the write-notification helper — no second fetch here.
    publishModal.onClose()
  }

  return (
    <section aria-label="小喇叭">
      <Card
        shadow="none"
        className={cn(
          // Same surface as the game cards below (HeroUI content1, light and
          // dark); the official row keeps its own semantic highlight.
          'max-h-[300px] w-full border border-default-200',
          // The first load pins the card to the same 300px the list can
          // reach, so a full list landing causes no height jump.
          initialLoading && 'h-[300px]'
        )}
      >
        {/* Align circle and avatar right edges: 12 + gutter + 40 equals
            body inset 16 + gutter + row inset 8 + avatar 28. */}
        <CardHeader className="flex shrink-0 flex-wrap items-center gap-3 py-3 pl-3 pr-4">
          <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden [scrollbar-gutter:stable_both-edges]">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary">
              <Megaphone className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              {/* One fixed 28px line: when the price chip no longer fits next
                  to the title it wraps onto a clipped second line and simply
                  disappears until the width is enough again. */}
              <div className="flex h-7 flex-wrap content-start items-center gap-2 overflow-hidden">
                <h2 className="shrink-0 text-lg font-bold">小喇叭</h2>
                <Chip
                  size="sm"
                  color="secondary"
                  variant="flat"
                  className="shrink-0"
                >
                  {SHOUTBOX_PRICE} 萌萌点/次
                </Chip>
              </div>
            </div>
          </div>
          <Button color="primary" onPress={handleClickPublish}>
            发布小喇叭
          </Button>
        </CardHeader>

        <CardBody className="min-h-0 gap-2 overflow-hidden px-4 pb-2 pt-0">
          {initialLoading ? (
            <div className="flex h-full items-center justify-center">
              <Spinner
                variant="default"
                size="md"
                color="primary"
                label="正在获取小喇叭..."
              />
            </div>
          ) : error && !data ? (
            <Alert
              color="danger"
              variant="flat"
              description="小喇叭加载失败"
              endContent={
                <Button
                  size="sm"
                  variant="light"
                  color="danger"
                  onPress={retry}
                >
                  重试
                </Button>
              }
            />
          ) : !pinned && rows.length === 0 ? (
            <p className="py-2 text-sm text-default-400">
              暂无小喇叭，来发第一条吧
            </p>
          ) : (
            <>
              {error !== '' && (
                // A failed background refresh keeps the rows and shows a
                // low-interference notice with a manual retry.
                <Alert
                  color="warning"
                  variant="flat"
                  description={error}
                  endContent={
                    <Button
                      size="sm"
                      variant="light"
                      color="warning"
                      onPress={retry}
                    >
                      重试
                    </Button>
                  }
                />
              )}
              <ScrollShadow
                className="min-h-0 divide-y divide-default-100 [scrollbar-gutter:stable_both-edges]"
                tabIndex={0}
                role="region"
                aria-label="小喇叭消息列表"
              >
                {pinned && (
                  <ShoutboxCard
                    item={pinned}
                    pinned
                    compact
                    showDelete={false}
                    currentUserId={currentUserId}
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
                {hasMore && (
                  // Last item inside the scroll region: only reachable by
                  // scrolling to the end, never a fixed footer.
                  <div className="flex justify-center py-1">
                    <Button
                      as={Link}
                      href="/shoutbox"
                      size="sm"
                      variant="light"
                      color="primary"
                      endContent={<ChevronRight className="size-4" />}
                    >
                      显示更多
                    </Button>
                  </div>
                )}
              </ScrollShadow>
            </>
          )}
        </CardBody>
      </Card>

      <ShoutboxPublishModal
        isOpen={publishModal.isOpen}
        onOpenChange={publishModal.onOpenChange}
        onPublished={handlePublished}
      />
      <ShoutboxLoginModal
        isOpen={loginModal.isOpen}
        onOpenChange={loginModal.onOpenChange}
      />
    </section>
  )
}
