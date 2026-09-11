import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import { getPatchVisibilityWhere } from '~/utils/actions/getPatchVisibilityWhere'
import { getCurrentBalance } from '~/app/api/moemoepoint/service'
import { prisma } from '~/prisma/index'
import {
  getPatchSubmissionQuota,
  listOwnPatchSubmissions
} from '~/app/api/patch-submission/service'
import { getUserPatch } from '~/app/api/user/profile/patch/service'
import { AdminEntryPanel } from '~/components/submission/AdminEntryPanel'
import { SubmissionList } from '~/components/submission/SubmissionList'
import { SubmissionQuotaPanel } from '~/components/submission/SubmissionQuotaPanel'
import { UserPatch } from '~/components/user/patch/Container'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '发布条目',
  robots: { index: false, follow: false }
}

export const dynamic = 'force-dynamic'

/**
 * One tab, two audiences. The profile owner manages how they publish here, while
 * everyone else sees only the entries that were approved and published.
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

  const publishedSection = published.total > 0 && (
    <section className="space-y-4">
      {/* Published entries render as the same public game cards visitors see,
          stats and all — not as submission rows. */}
      <h2 className="text-xl">已发布条目</h2>
      <UserPatch
        galgames={published.galgames}
        total={published.total}
        uid={profileId}
      />
    </section>
  )

  if (payload && payload.uid === profileId) {
    const list = await listOwnPatchSubmissions(profileId, 1, 50)
    // A published submission is represented by its live entry below, so the
    // management list only carries the ones still in flight or closed.
    const inFlight = list.submissions.filter(
      (submission) => submission.status !== 'published'
    )
    // Same gate as /edit/create: these users publish directly, so they get the
    // editor instead of the deposit-backed submission flow.
    const canPublishDirectly = payload.role >= 4

    if (canPublishDirectly) {
      return (
        <div className="w-full py-4 mx-auto space-y-6">
          <AdminEntryPanel />
          {/* Someone promoted after submitting still needs to finish or delete
              those drafts, otherwise their deposit stays reserved forever. */}
          {inFlight.length > 0 && <SubmissionList submissions={inFlight} />}
          {publishedSection}
        </div>
      )
    }

    const [quota, balance] = await Promise.all([
      getPatchSubmissionQuota(profileId, payload.role),
      getCurrentBalance(prisma, profileId)
    ])

    return (
      <div className="w-full py-4 mx-auto space-y-6">
        <SubmissionQuotaPanel quota={quota} balance={balance} />
        <SubmissionList submissions={inFlight} />
        {publishedSection}
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
