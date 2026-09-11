import { notFound } from 'next/navigation'
import { requireDashboardUser } from '~/lib/dashboard/auth'
import { getAdminPatchSubmission } from '~/app/api/admin/patch-submission/service'
import { adminInboxIdSchema } from '~/validations/inbox'
import { PatchSubmissionPreviewView } from '~/components/submission/PatchSubmissionPreviewView'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: '投稿预览',
  robots: { index: false, follow: false }
}

export default async function SubmissionPreviewPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireDashboardUser()
  const input = adminInboxIdSchema.safeParse((await params).id)
  if (!input.success) notFound()
  const result = await getAdminPatchSubmission(input.data, user.role)
  if (typeof result === 'string' || !result.preview) notFound()
  return (
    <PatchSubmissionPreviewView
      preview={result.preview}
      createdAt={result.created}
    />
  )
}
