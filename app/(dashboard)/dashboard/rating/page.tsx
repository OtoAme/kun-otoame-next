import type { Metadata } from 'next'
import { DashboardRatings } from '~/components/dashboard/rating/DashboardRatings'

export const metadata: Metadata = { title: '评价' }

export default function DashboardRatingsPage() {
  return <DashboardRatings />
}
