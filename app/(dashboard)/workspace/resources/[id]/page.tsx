import { notFound } from 'next/navigation'
import { WorkspaceResourceEditor } from '~/components/dashboard/workspace/WorkspaceResourceEditor'

export default async function WorkspaceResourcePage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ linkId?: string | string[] }>
}) {
  const { id } = await params
  const resourceId = Number(id)
  if (
    !/^[1-9]\d*$/.test(id) ||
    !Number.isSafeInteger(resourceId) ||
    resourceId > 2147483647
  ) {
    notFound()
  }
  const query = await searchParams
  const rawLinkId = typeof query.linkId === 'string' ? query.linkId : ''
  const focusLinkId =
    /^[1-9]\d*$/.test(rawLinkId) && Number(rawLinkId) <= 2147483647
      ? Number(rawLinkId)
      : undefined

  return (
    <WorkspaceResourceEditor
      resourceId={resourceId}
      focusLinkId={focusLinkId}
    />
  )
}
