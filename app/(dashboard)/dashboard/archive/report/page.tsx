import type { Metadata } from 'next'
import { DashboardReportArchive } from '~/components/dashboard/archive/DashboardReportArchive'
import { requireDashboardUser } from '~/lib/dashboard/auth'

export const metadata: Metadata = { title: '旧举报' }

export default async function DashboardReportArchivePage() {
  const currentUser = await requireDashboardUser()
  return <DashboardReportArchive viewerRole={currentUser.role} />
}
