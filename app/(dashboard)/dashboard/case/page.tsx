import { CaseCenter } from '~/components/dashboard/case/CaseCenter'
import { requireDashboardUser } from '~/lib/dashboard/auth'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '事项中心'
}

export default async function DashboardCaseCenterPage() {
  await requireDashboardUser()
  return <CaseCenter />
}
