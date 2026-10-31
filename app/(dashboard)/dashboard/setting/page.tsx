import type { Metadata } from 'next'
import { DashboardSettings } from '~/components/dashboard/setting/DashboardSettings'
import { requireDashboardUser } from '~/lib/dashboard/auth'

export const metadata: Metadata = { title: '站点设置' }

export default async function DashboardSettingsPage() {
  const currentUser = await requireDashboardUser()
  if (currentUser.role < 4) {
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        本页面仅超级管理员可访问
      </p>
    )
  }
  return <DashboardSettings />
}
