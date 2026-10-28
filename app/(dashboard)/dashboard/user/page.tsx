import { DashboardPageHeader } from '~/components/dashboard/page/DashboardPage'
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

  return (
    <DashboardPageHeader
      title="用户管理"
      description="按用户名、邮箱或编号查找用户，编辑资料与身份、发放萌萌点或删除账号。删除不可撤销。"
    >
      <DashboardUsers currentUserId={currentUser.id} />
    </DashboardPageHeader>
  )
}
