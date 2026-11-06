import { notFound } from 'next/navigation'
import { requireDashboardUser } from '~/lib/dashboard/auth'
import { getAdminInboxItem } from '~/app/api/admin/inbox/service'
import { adminInboxIdSchema } from '~/validations/inbox'
import { Card, CardBody } from '@heroui/react'
import { ResourceDownload } from '~/components/patch/resource/ResourceDownload'
import { ResourceInfo } from '~/components/patch/resource/ResourceInfo'

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
  const viewer = await requireDashboardUser()
  const input = adminInboxIdSchema.safeParse((await params).id)
  if (!input.success) notFound()
  const result = await getAdminInboxItem(
    {
      kind: 'resource-apply',
      id: input.data
    },
    undefined,
    { uid: viewer.id, role: viewer.role }
  )
  if (result.state !== 'pending' || result.item.kind !== 'resource-apply')
    notFound()
  // Same card composition as the game page's resource list (attribute chips
  // above the download block), without the report and manage actions.
  return (
    <Card
      shadow="none"
      radius="lg"
      className="min-w-0 max-w-full overflow-visible border border-default-200"
    >
      <CardBody className="min-w-0 max-w-full space-y-2 overflow-visible p-3">
        <ResourceInfo resource={result.item.payload} />
        <ResourceDownload resource={result.item.payload} preview />
      </CardBody>
    </Card>
  )
}
