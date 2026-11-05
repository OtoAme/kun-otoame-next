import { DashboardResourceMerges } from '~/components/dashboard/official-mirror/DashboardResourceMerges'
import { requireDashboardUser } from '~/lib/dashboard/auth'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '资源合并'
}

// The workbench renders its own single heading inside its scroll root.
export default async function DashboardResourceMergesPage() {
  await requireDashboardUser()
  return <DashboardResourceMerges />
}
