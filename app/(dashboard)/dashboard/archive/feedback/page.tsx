import type { Metadata } from 'next'
import { DashboardFeedbackArchive } from '~/components/dashboard/archive/DashboardFeedbackArchive'
import { requireDashboardUser } from '~/lib/dashboard/auth'

export const metadata: Metadata = { title: '旧反馈' }

export default async function DashboardFeedbackArchivePage() {
  const currentUser = await requireDashboardUser()
  return <DashboardFeedbackArchive viewerRole={currentUser.role} />
}
