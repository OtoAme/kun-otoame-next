import { notFound } from 'next/navigation'
import { getHelpPost } from '~/app/api/help/service'
import { KunBreadcrumbTitle } from '~/components/kun/BreadcrumbTitle'
import { HelpPostView } from '~/components/help/HelpPostView'
import { getPatchVisibilityWhere } from '~/utils/actions/getPatchVisibilityWhere'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import type { Metadata } from 'next'

export const revalidate = 0

interface Props {
  params: Promise<{ id: string }>
}

const parseId = (raw: string) => {
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export const metadata: Metadata = { title: '求助详情' }

export default async function HelpDetailPage({ params }: Props) {
  const id = parseId((await params).id)
  if (id === null) notFound()
  const payload = await verifyHeaderCookie()
  const post = await getHelpPost(
    id,
    payload ? { uid: payload.uid, role: payload.role } : null,
    await getPatchVisibilityWhere()
  )
  if (typeof post === 'string') notFound()
  return (
    <>
      <KunBreadcrumbTitle routeKey={`/help/${post.id}`} title={post.title} />
      <HelpPostView initial={post} />
    </>
  )
}
