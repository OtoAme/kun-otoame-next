import { DashboardInbox } from '~/components/dashboard/DashboardInbox'
import { requireDashboardUser } from '~/lib/dashboard/auth'

export default async function DashboardPage() {
  const currentUser = await requireDashboardUser()
  return (
    <DashboardInbox
      reviewerId={currentUser.id}
      reviewerRole={currentUser.role}
    />
  )
}
