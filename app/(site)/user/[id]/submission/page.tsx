import Link from 'next/link'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import { getPatchVisibilityWhere } from '~/utils/actions/getPatchVisibilityWhere'
import { getUserPatch } from '~/app/api/user/profile/patch/service'
import { UserPatch } from '~/components/user/patch/Container'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '发布条目',
  robots: { index: false, follow: false }
}

export const dynamic = 'force-dynamic'

/**
 * Public profile tab. Private submission management lives in the workspace;
 * this page only shows the entries visitors are already allowed to see.
 */
export default async function UserSubmissionPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const profileId = Number(id)
  const payload = await verifyHeaderCookie()
  const visibilityWhere = await getPatchVisibilityWhere()
  const published = await getUserPatch(
    { uid: profileId, page: 1, limit: 20 },
    visibilityWhere
  )
  const isOwner = Boolean(payload && payload.uid === profileId)

  return (
    <div className="mx-auto w-full space-y-6 py-4">
      {isOwner ? (
        <p className="text-sm text-default-500">
          投稿、额度和资源维护已移到
          <Link href="/workspace/entries" className="mx-1 text-primary">
            用户工作台
          </Link>
          。这里只展示已发布的公开条目。
        </p>
      ) : null}
      <section className="space-y-4">
        <h2 className="text-xl">已发布条目</h2>
        <UserPatch
          galgames={published.galgames}
          total={published.total}
          uid={profileId}
        />
      </section>
    </div>
  )
}
