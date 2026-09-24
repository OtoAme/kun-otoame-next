import type { Metadata } from 'next'
import { DashboardCompanyMerges } from '~/components/dashboard/company-merges/DashboardCompanyMerges'
import { requireDashboardUser } from '~/lib/dashboard/auth'

export const metadata: Metadata = {
  title: '会社合并'
}

export default async function DashboardCompanyMergesPage() {
  await requireDashboardUser()
  return <DashboardCompanyMerges />
}
