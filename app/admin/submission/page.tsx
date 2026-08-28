import { redirect } from 'next/navigation'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import { listAdminPatchSubmissions } from '~/app/api/admin/patch-submission/service'
import { AdminSubmissionQueue } from '~/components/admin/submission/AdminSubmissionQueue'
import {
  ADMIN_SUBMISSION_QUEUE_LIMIT,
  parseAdminSubmissionSearchParams
} from '~/components/admin/submission/queueParams'

export const dynamic = 'force-dynamic'

export default async function AdminSubmissionPage({
  searchParams
}: {
  searchParams: Promise<{ query?: string; status?: string; page?: string }>
}) {
  const payload = await verifyHeaderCookie()
  if (!payload) {
    redirect('/')
  }

  const { query, status, page } = parseAdminSubmissionSearchParams(
    await searchParams
  )
  const result = await listAdminPatchSubmissions({
    page,
    limit: ADMIN_SUBMISSION_QUEUE_LIMIT,
    status,
    query,
    reviewerRole: payload.role
  })

  if (typeof result === 'string') {
    return <p className="text-sm text-danger">{result}</p>
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl">投稿审核</h1>
      <AdminSubmissionQueue
        submissions={result.submissions}
        total={result.total}
        query={query}
        status={status}
        page={page}
        limit={ADMIN_SUBMISSION_QUEUE_LIMIT}
      />
    </div>
  )
}
