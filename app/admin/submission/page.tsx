import { redirect } from 'next/navigation'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import { listAdminPatchSubmissions } from '~/app/api/admin/patch-submission/service'
import { AdminSubmissionQueue } from '~/components/admin/submission/AdminSubmissionQueue'

export const dynamic = 'force-dynamic'

export default async function AdminSubmissionPage({
  searchParams
}: {
  searchParams: Promise<{ query?: string }>
}) {
  const payload = await verifyHeaderCookie()
  if (!payload) {
    redirect('/')
  }

  const { query } = await searchParams
  const result = await listAdminPatchSubmissions({
    page: 1,
    limit: 50,
    query: query ?? '',
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
        query={query ?? ''}
      />
    </div>
  )
}
