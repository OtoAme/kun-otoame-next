import { notFound } from 'next/navigation'
import { CaseCenter } from '~/components/dashboard/case/CaseCenter'
import { requireDashboardUser } from '~/lib/dashboard/auth'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '事项详情'
}

// Deep links from notifications and the public issue pages land here. The
// case center renders the same console with this case already open, so the
// detail is never a page of its own with a different layout.
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

  return <CaseCenter initialCaseId={caseId} />
}
