import { DashboardPageHeader } from '~/components/dashboard/page/DashboardPage'
import type { Metadata } from 'next'
import { DashboardCompanyMerges } from '~/components/dashboard/company-merges/DashboardCompanyMerges'
import { requireDashboardUser } from '~/lib/dashboard/auth'

export const metadata: Metadata = {
  title: '会社合并'
}

export default async function DashboardCompanyMergesPage() {
  await requireDashboardUser()
  return (
    <DashboardPageHeader
      title="会社合并"
      description="系统检测到的疑似重复会社。核对后合并到保留的会社，或驳回这条建议；处理结果可在已合并、已驳回中复查。"
    >
      <DashboardCompanyMerges />
    </DashboardPageHeader>
  )
}
