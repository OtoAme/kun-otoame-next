import { notFound } from 'next/navigation'
import { requireDashboardUser } from '~/lib/dashboard/auth'
import { getAdminInboxItem } from '~/app/api/admin/inbox/service'
import { adminInboxIdSchema } from '~/validations/inbox'
import { ResourceDownload } from '~/components/patch/resource/ResourceDownload'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: '资源预览',
  robots: { index: false, follow: false }
}

export default async function ResourcePreviewPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  await requireDashboardUser()
  const input = adminInboxIdSchema.safeParse((await params).id)
  if (!input.success) notFound()
  const result = await getAdminInboxItem({
    kind: 'resource-apply',
    id: input.data
  })
  if (result.state !== 'pending' || result.item.kind !== 'resource-apply')
    notFound()
  return <ResourceDownload resource={result.item.payload} preview />
}
