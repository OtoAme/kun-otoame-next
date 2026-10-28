import type { Metadata } from 'next'
import { DashboardLogs } from '~/components/dashboard/log/DashboardLogs'

export const metadata: Metadata = { title: '管理日志' }

export default function DashboardLogsPage() {
  return <DashboardLogs />
}
