'use client'

import Link from 'next/link'
import { Megaphone, X } from 'lucide-react'
import { Button } from '~/components/dashboard/ui/button'
import { useShoutboxBanner } from '~/hooks/useShoutboxBanner'

/**
 * Important official message banner for the console layout. Shares only the
 * fetch + per-message local dismissal protocol with the site banner; the
 * styling is implemented separately on shadcn tokens.
 */
export const DashboardShoutboxBanner = () => {
  const { banner, dismiss } = useShoutboxBanner(true)

  if (!banner) {
    return null
  }

  return (
    <div
      role="region"
      aria-label="站点公告"
      className="shrink-0 border-b bg-primary/10 px-4 py-2"
    >
      <div className="flex items-start gap-2">
        <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1 text-sm">
          <span className="whitespace-pre-wrap break-words">
            {banner.content}
          </span>
          {banner.link ? (
            <Link
              href={banner.link}
              className="ml-2 whitespace-nowrap text-primary underline underline-offset-4"
            >
              查看详情
            </Link>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="关闭公告"
          onClick={dismiss}
          className="shrink-0"
        >
          <X />
        </Button>
      </div>
    </div>
  )
}
