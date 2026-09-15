import { notFound } from 'next/navigation'
import { DashboardCaseDetail } from '~/components/dashboard/case/DashboardCaseDetail'
import { requireDashboardUser } from '~/lib/dashboard/auth'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '事项详情'
}

export default async function DashboardCasePage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  await requireDashboardUser()
  const { id } = await params
  const caseId = Number(id)
  if (!Number.isSafeInteger(caseId) || caseId < 1) {
    notFound()
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="w-full min-w-0 max-w-3xl p-4 md:p-6">
        <DashboardCaseDetail caseId={caseId} />
      </div>
    </div>
  )
}
