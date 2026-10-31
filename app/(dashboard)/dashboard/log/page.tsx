import type { Metadata } from 'next'
import { DashboardLogs } from '~/components/dashboard/log/DashboardLogs'
import { requireDashboardUser } from '~/lib/dashboard/auth'

export const metadata: Metadata = { title: '管理日志' }

export default async function DashboardLogsPage() {
  const currentUser = await requireDashboardUser()
  return <DashboardLogs viewerRole={currentUser.role} />
}
