import { DashboardPageHeader } from '~/components/dashboard/page/DashboardPage'
import { DashboardBackup } from '~/components/dashboard/official-mirror/DashboardBackup'
import { requireDashboardUser } from '~/lib/dashboard/auth'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '站方备份'
}

export default async function DashboardBackupPage() {
  const user = await requireDashboardUser()
  return (
    <DashboardPageHeader title="站方备份">
      <DashboardBackup reviewer={{ id: user.id, role: user.role }} />
    </DashboardPageHeader>
  )
}
