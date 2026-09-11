import type { Metadata } from 'next'
import { DashboardUsers } from '~/components/dashboard/user/DashboardUsers'
import { requireDashboardUser } from '~/lib/dashboard/auth'

export const metadata: Metadata = { title: '用户管理' }

export default async function DashboardUsersPage() {
  const currentUser = await requireDashboardUser()
  if (currentUser.role < 4) {
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        本页面仅超级管理员可访问
      </p>
    )
  }

  return <DashboardUsers currentUserId={currentUser.id} />
}
