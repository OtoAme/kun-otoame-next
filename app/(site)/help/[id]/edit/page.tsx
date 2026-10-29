import { notFound, redirect } from 'next/navigation'
import { getHelpPost } from '~/app/api/help/service'
import { KunBreadcrumbTitle } from '~/components/kun/BreadcrumbTitle'
import { HelpPostForm } from '~/components/help/HelpPostForm'
import { getPatchVisibilityWhere } from '~/utils/actions/getPatchVisibilityWhere'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import { prisma } from '~/prisma/index'
import type { Metadata } from 'next'

export const revalidate = 0

export const metadata: Metadata = { title: '编辑求助' }

interface Props {
  params: Promise<{ id: string }>
}

export default async function HelpEditPage({ params }: Props) {
  const id = Number((await params).id)
  if (!Number.isSafeInteger(id) || id <= 0) notFound()
  const payload = await verifyHeaderCookie()
  if (!payload) redirect('/login')
  const post = await getHelpPost(
    id,
    { uid: payload.uid, role: payload.role },
    await getPatchVisibilityWhere()
  )
  if (typeof post === 'string' || !post.isAuthor) notFound()
  const row = await prisma.help_post.findUnique({
    where: { id },
    select: { resource_id: true }
  })
  return (
    <div className="container mx-auto my-4 max-w-3xl">
      <KunBreadcrumbTitle routeKey={`/help/${post.id}`} title={post.title} />
      <HelpPostForm
        initial={{
          postId: post.id,
          category: post.category,
          title: post.title,
          content: post.markdown ?? '',
          patch: post.patch,
          gameName: post.gameName,
          gameLinks: post.gameLinks,
          resourceId: post.patch ? (row?.resource_id ?? null) : null
        }}
      />
    </div>
  )
}
