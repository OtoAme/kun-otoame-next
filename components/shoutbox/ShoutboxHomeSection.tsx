'use client'

import Link from 'next/link'
import { Alert } from '@heroui/alert'
import { Button } from '@heroui/button'
import { ChevronRight } from 'lucide-react'
import { KunLoading } from '~/components/kun/Loading'
import { useShoutboxFeed } from '~/hooks/useShoutboxFeed'
import { ShoutboxCompactRow } from '../shoutbox/ShoutboxCompactRow'

/**
 * Home page shoutbox module: first page only (6 slots, the pinned official
 * message included), newest first, with a "view more" entry. Data is fetched
 * client-side so the static home payload never freezes a time boundary.
 */
export const ShoutboxHomeSection = () => {
  const { data, loading, error, retry } = useShoutboxFeed({})
  const pinned = data?.pinned ?? null
  // The pinned official message occupies one of the six slots; bound the
  // ordinary rows so the module can never render seven even if a malformed
  // response carries six rows alongside a pinned one.
  const rows = (data?.shoutboxes ?? []).slice(0, pinned ? 5 : 6)

  return (
    <section className="space-y-6" aria-label="小喇叭">
      <div className="flex items-center space-x-4">
        <h2 className="kun-home-section-title text-lg font-bold sm:text-2xl">
          小喇叭
        </h2>
        <Button
          className="kun-home-section-more-button"
          variant="light"
          as={Link}
          color="primary"
          endContent={<ChevronRight className="size-4" />}
          href="/shoutbox"
        >
          查看更多
        </Button>
      </div>

      {loading && !data ? (
        <KunLoading hint="正在获取小喇叭..." />
      ) : error && !data ? (
        <Alert
          color="danger"
          variant="flat"
          description="小喇叭加载失败"
          endContent={
            <Button size="sm" variant="light" color="danger" onPress={retry}>
              重试
            </Button>
          }
        />
      ) : !pinned && rows.length === 0 ? (
        <p className="text-sm text-default-400">暂无小喇叭，来发第一条吧</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {pinned && <ShoutboxCompactRow item={pinned} pinned />}
          {rows.map((item) => (
            <ShoutboxCompactRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  )
}
