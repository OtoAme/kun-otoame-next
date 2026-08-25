import { NextRequest, NextResponse } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { patchSubmissionIdSchema } from '~/validations/patchSubmission'
import { checkPatchSubmissionRateLimit } from '~/app/api/patch-submission/rateLimit'
import { getPatchSubmissionPublishPreview } from '~/app/api/patch-submission/service'

const privateJson = (body: unknown) =>
  NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } })

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const user = await verifyHeaderCookie(req)
  if (!user) return privateJson('用户未登录')

  const limited = await checkPatchSubmissionRateLimit('read', user.uid)
  if (limited) return privateJson(limited)

  const { id } = await params
  const parsed = patchSubmissionIdSchema.safeParse({ submissionId: id })
  if (!parsed.success) return privateJson('投稿 ID 不正确')

  return privateJson(
    await getPatchSubmissionPublishPreview(parsed.data.submissionId, user.uid)
  )
}
