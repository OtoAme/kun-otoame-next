import { redirect } from 'next/navigation'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import { ErrorComponent } from '~/components/error/ErrorComponent'
import { getAdminPatchSubmission } from '~/app/api/admin/patch-submission/service'
import { AdminSubmissionDetail } from '~/components/admin/submission/AdminSubmissionDetail'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '投稿审核详情',
  robots: { index: false, follow: false }
}

export const dynamic = 'force-dynamic'

export default async function AdminSubmissionDetailPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const reviewer = await verifyHeaderCookie()
  if (!reviewer) {
    redirect('/login')
  }

  const { id } = await params
  if (!/^\d+$/.test(id)) {
    return <ErrorComponent error="投稿 ID 不合法" />
  }

  const submission = await getAdminPatchSubmission(Number(id), reviewer.role)
  if (typeof submission === 'string') {
    return <ErrorComponent error={submission} />
  }

  return (
    <AdminSubmissionDetail
      submission={submission}
      reviewerId={reviewer.uid}
      reviewerRole={reviewer.role}
    />
  )
}
