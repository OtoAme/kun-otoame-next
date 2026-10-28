import type { Metadata } from 'next'
import { DashboardComments } from '~/components/dashboard/comment/DashboardComments'

export const metadata: Metadata = { title: '评论' }

export default function DashboardCommentsPage() {
  return <DashboardComments />
}
