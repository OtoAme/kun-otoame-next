import { notFound } from 'next/navigation'
import { Card, CardBody } from '@heroui/react'
import { requireDashboardUser } from '~/lib/dashboard/auth'
import {
  loadMergeSurvivorCard,
  parseMergePreviewQuery
} from '~/lib/officialMirror/previewCard'
import { ResourceDownload } from '~/components/patch/resource/ResourceDownload'
import { ResourceInfo } from '~/components/patch/resource/ResourceInfo'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: '合并后预览',
  robots: { index: false, follow: false }
}

/** Read-only public card of the survivor of `?user=<id>&staff=<id>`. */
export default async function ResourceMergePreviewPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const viewer = await requireDashboardUser()
  if (viewer.role < 3) notFound()
  const query = await searchParams
  const input = parseMergePreviewQuery({
    user: query.user,
    staff: query.staff
  })
  if (!input) notFound()
  const resource = await loadMergeSurvivorCard(input)
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
