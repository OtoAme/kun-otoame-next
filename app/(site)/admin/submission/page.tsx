import { redirect } from 'next/navigation'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import { listAdminPatchSubmissions } from '~/app/api/admin/patch-submission/service'
import { AdminSubmissionQueue } from '~/components/admin/submission/AdminSubmissionQueue'
import {
  ADMIN_SUBMISSION_QUEUE_LIMIT,
  buildAdminSubmissionQueueUrl,
  parseAdminSubmissionSearchParams,
  resolveAdminSubmissionQueuePage
} from '~/components/admin/submission/queueParams'

export const dynamic = 'force-dynamic'

export default async function AdminSubmissionPage({
  searchParams
}: {
  searchParams: Promise<{
    query?: string | string[]
    status?: string | string[]
    page?: string | string[]
  }>
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

  // 队列会在审核过程中变短, 页码落到列表外面就把人送回还有内容的地方;
  // 取回的行数和总数都可能过期, 所以每次重定向都严格往前退, 不会来回跳转。
  const resolvedPage = resolveAdminSubmissionQueuePage(
    page,
    result.total,
    ADMIN_SUBMISSION_QUEUE_LIMIT,
    result.submissions.length
  )
  if (resolvedPage !== page) {
    redirect(buildAdminSubmissionQueueUrl({ query, status, page: resolvedPage }))
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
