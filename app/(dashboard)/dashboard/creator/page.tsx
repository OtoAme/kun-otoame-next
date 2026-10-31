import type { Metadata } from 'next'
import { DashboardCreators } from '~/components/dashboard/creator/DashboardCreators'

export const metadata: Metadata = { title: '创作者申请' }

export default function DashboardCreatorsPage() {
  return <DashboardCreators />
}
