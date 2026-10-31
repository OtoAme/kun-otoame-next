import { CaseCenter } from '~/components/dashboard/case/CaseCenter'
import { requireDashboardUser } from '~/lib/dashboard/auth'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '问题处理'
}

export default async function DashboardCaseCenterPage() {
  await requireDashboardUser()
  return <CaseCenter />
}
