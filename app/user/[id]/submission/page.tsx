import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import { getPatchVisibilityWhere } from '~/utils/actions/getPatchVisibilityWhere'
import { getCurrentBalance } from '~/app/api/moemoepoint/service'
import { prisma } from '~/prisma/index'
import {
  getPatchSubmissionQuota,
  listOwnPatchSubmissions
} from '~/app/api/patch-submission/service'
import { getUserPatch } from '~/app/api/user/profile/patch/service'
import { SubmissionList } from '~/components/submission/SubmissionList'
import { UserPatch } from '~/components/user/patch/Container'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '发布条目',
  robots: { index: false, follow: false }
}

export const dynamic = 'force-dynamic'

/**
 * One tab, two audiences. The profile owner manages their submissions here —
 * drafts, review states, the deposit and quota. Everyone else sees only the
 * entries that were approved and published, as public game cards.
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

  if (payload && payload.uid === profileId) {
    const [list, quota, balance] = await Promise.all([
      listOwnPatchSubmissions(profileId, 1, 50),
      getPatchSubmissionQuota(profileId, payload.role),
      getCurrentBalance(prisma, profileId)
    ])

    return (
      <div className="w-full py-4 mx-auto space-y-6">
        <SubmissionList
          submissions={list.submissions}
          quota={quota}
          balance={balance}
        />
        {published.total > 0 && (
          <section className="space-y-4">
            {/* Published entries render as the same public game cards visitors
                see, stats and all — not as submission rows. */}
            <h2 className="text-xl">已发布条目</h2>
            <UserPatch
              galgames={published.galgames}
              total={published.total}
              uid={profileId}
            />
          </section>
        )}
      </div>
    )
  }

  return (
    <div className="w-full py-4 mx-auto">
      <UserPatch
        galgames={published.galgames}
        total={published.total}
        uid={profileId}
      />
    </div>
  )
}
