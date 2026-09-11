import { Skeleton } from '~/components/dashboard/ui/skeleton'

interface InboxDetailSkeletonProps {
  // Accessible loading announcement; each fetch phase passes its own label.
  label?: string
}

// Both fetch stages share geometry and leave padding to the detail container.
// Static blocks keep a remount from restarting the loading animation.
export function InboxDetailSkeleton({
  label = '正在加载事项详情'
}: InboxDetailSkeletonProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className="space-y-3"
    >
      <Skeleton className="h-6 w-2/3 animate-none" />
      <Skeleton className="h-4 w-1/4 animate-none" />
      <Skeleton className="h-24 w-full animate-none" />
      <Skeleton className="h-48 w-full animate-none" />
    </div>
  )
}
