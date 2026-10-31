import { DashboardPageHeader } from '~/components/dashboard/page/DashboardPage'
import { DashboardShoutbox } from '~/components/dashboard/shoutbox/DashboardShoutbox'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '小喇叭管理'
}

export default function DashboardShoutboxPage() {
  return (
    <DashboardPageHeader title="小喇叭">
      <DashboardShoutbox />
    </DashboardPageHeader>
  )
}
