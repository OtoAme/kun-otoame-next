import { notFound } from 'next/navigation'
import { Card, CardBody } from '@heroui/card'
import { requireDashboardUser } from '~/lib/dashboard/auth'
import {
  loadPreviewResourceCard,
  parsePreviewResourceId
} from '~/lib/officialMirror/previewCard'
import { ResourceDownload } from '~/components/patch/resource/ResourceDownload'
import { ResourceInfo } from '~/components/patch/resource/ResourceInfo'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: '资源卡片预览',
  robots: { index: false, follow: false }
}

/** Read-only public card of any resource, for the merge workbench frames. */
export default async function ResourceCardPreviewPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const viewer = await requireDashboardUser()
  if (viewer.role < 3) notFound()
  const resourceId = parsePreviewResourceId((await params).id)
  if (resourceId === null) notFound()
  const resource = await loadPreviewResourceCard(resourceId)
  if (!resource) notFound()
  // Same card composition as the game page's resource list, without the
  // report and manage actions. The layout supplies the size marker.
  return (
    <Card
      shadow="none"
      radius="lg"
      className="min-w-0 max-w-full overflow-visible border border-default-200"
    >
      <CardBody className="min-w-0 max-w-full space-y-2 overflow-visible p-3">
        <ResourceInfo resource={resource} />
        <ResourceDownload resource={resource} preview />
      </CardBody>
    </Card>
  )
}
