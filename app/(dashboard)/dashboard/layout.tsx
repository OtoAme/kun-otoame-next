import { DashboardShell } from '~/components/dashboard/DashboardShell'
import { requireDashboardUser } from '~/lib/dashboard/auth'

export default async function DashboardLayout({
  children
}: {
  children: React.ReactNode
}) {
  const currentUser = await requireDashboardUser()
  return <DashboardShell currentUser={currentUser}>{children}</DashboardShell>
}
