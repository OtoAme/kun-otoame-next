import { DashboardPageHeader } from '~/components/dashboard/page/DashboardPage'
import { DashboardResourceMerges } from '~/components/dashboard/official-mirror/DashboardResourceMerges'
import { requireDashboardUser } from '~/lib/dashboard/auth'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '资源合并'
}

export default async function DashboardResourceMergesPage() {
  await requireDashboardUser()
  return (
    <DashboardPageHeader title="资源合并">
      <DashboardResourceMerges />
    </DashboardPageHeader>
  )
}
