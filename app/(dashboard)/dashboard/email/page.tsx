import type { Metadata } from 'next'
import { DashboardEmail } from '~/components/dashboard/email/DashboardEmail'
import { requireDashboardUser } from '~/lib/dashboard/auth'

export const metadata: Metadata = { title: '邮件群发' }

export default async function DashboardEmailPage() {
  const currentUser = await requireDashboardUser()
  if (currentUser.role < 4) {
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        本页面仅超级管理员可访问
      </p>
    )
  }
  return <DashboardEmail />
}
