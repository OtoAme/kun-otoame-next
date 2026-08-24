import { redirect } from 'next/navigation'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import { getPatchSubmission } from '~/app/api/patch-submission/service'
import { SubmissionEditor } from '~/components/submission/SubmissionEditor'
import type { Metadata } from 'next'

/** A draft is private to its author, so it must never be indexed or cached. */
export const metadata: Metadata = {
  title: '投稿游戏条目',
  robots: { index: false, follow: false }
}

export const dynamic = 'force-dynamic'

export default async function SubmissionPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const payload = await verifyHeaderCookie()
  if (!payload) {
    redirect('/login')
  }

  const { id } = await params
  const submissionId = Number(id)
  if (!Number.isSafeInteger(submissionId) || submissionId < 1) {
    redirect('/')
  }

  const submission = await getPatchSubmission(submissionId, payload.uid)
  if (typeof submission === 'string') {
    redirect('/')
  }

  return <SubmissionEditor submission={submission} />
}
