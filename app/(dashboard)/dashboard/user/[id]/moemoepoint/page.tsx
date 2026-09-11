import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DashboardLedger } from '~/components/dashboard/user/DashboardLedger'
import { requireDashboardUser } from '~/lib/dashboard/auth'

export const metadata: Metadata = { title: '用户萌萌点明细' }

export default async function DashboardLedgerPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const currentUser = await requireDashboardUser()
  const { id } = await params
  const userId = Number(id)
  if (
    !/^\d+$/.test(id) ||
    !Number.isSafeInteger(userId) ||
    userId < 1 ||
    userId > 9999999
  ) {
    notFound()
  }

  return (
    <DashboardLedger
      key={userId}
      userId={userId}
      currentUserId={currentUser.id}
    />
  )
}
