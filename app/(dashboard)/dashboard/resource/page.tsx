import type { Metadata } from 'next'
import { DashboardResources } from '~/components/dashboard/resource/DashboardResources'

export const metadata: Metadata = { title: '下载资源' }

export default function DashboardResourcesPage() {
  return <DashboardResources />
}
