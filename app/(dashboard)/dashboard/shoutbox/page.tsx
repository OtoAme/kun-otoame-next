import { DashboardPageHeader } from '~/components/dashboard/page/DashboardPage'
import { DashboardShoutbox } from '~/components/dashboard/shoutbox/DashboardShoutbox'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '小喇叭管理'
}

export default function DashboardShoutboxPage() {
  return (
    <DashboardPageHeader
      title="小喇叭"
      description="发布官方消息（重要级会作为全站横幅），复核待处理的小喇叭，查看公开中和已终止的记录。"
    >
      <DashboardShoutbox />
    </DashboardPageHeader>
  )
}
