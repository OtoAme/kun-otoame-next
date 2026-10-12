import { LinkHealthAdminClient } from '~/components/dashboard/link-health/LinkHealthAdminClient'
import { requireDashboardUser } from '~/lib/dashboard/auth'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '已失效链接'
}

export default async function DashboardLinkHealthPage() {
  await requireDashboardUser()
  return <LinkHealthAdminClient />
}
