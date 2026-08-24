import { redirect } from 'next/navigation'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import { getCurrentBalance } from '~/app/api/moemoepoint/service'
import { prisma } from '~/prisma/index'
import {
  getPatchSubmissionQuota,
  listOwnPatchSubmissions
} from '~/app/api/patch-submission/service'
import { SubmissionList } from '~/components/submission/SubmissionList'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '我的投稿',
  robots: { index: false, follow: false }
}

export const dynamic = 'force-dynamic'

/** Only the author sees this tab; there is nothing here for anyone else. */
export default async function UserSubmissionPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const payload = await verifyHeaderCookie()
  if (!payload) {
    redirect('/login')
  }

  const { id } = await params
  if (Number(id) !== payload.uid) {
    redirect(`/user/${id}`)
  }

  const [list, quota, balance] = await Promise.all([
    listOwnPatchSubmissions(payload.uid, 1, 50),
    getPatchSubmissionQuota(payload.uid, payload.role),
    getCurrentBalance(prisma, payload.uid)
  ])

  return (
    <div className="w-full max-w-4xl py-4 mx-auto">
      <SubmissionList
        submissions={list.submissions}
        quota={quota}
        balance={balance}
      />
    </div>
  )
}
