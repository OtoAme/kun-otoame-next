'use client'

import Link from 'next/link'
import { Button } from '~/components/dashboard/ui/button'

export default function DashboardError({
  reset
}: {
  error: Error
  reset: () => void
}) {
  return (
    <main className="flex min-h-80 flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-lg font-semibold">后台暂时无法加载</h1>
      <p className="text-sm text-muted-foreground">
        请重试；若问题持续，可以返回前台。
      </p>
      <div className="flex gap-3">
        <Button onClick={reset}>重试</Button>
        <Button asChild variant="outline">
          <Link href="/" prefetch={false}>
            返回前台
          </Link>
        </Button>
      </div>
    </main>
  )
}
