import { NextRequest, NextResponse } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { patchSubmissionIdSchema } from '~/validations/patchSubmission'
import { checkPatchSubmissionRateLimit } from '~/app/api/patch-submission/rateLimit'
import { PatchSubmissionError } from '~/app/api/patch-submission/quota'
import {
  assertCanFetchPatchSubmissionExternalData,
  fetchAndSavePatchSubmissionExternalData,
  patchSubmissionExternalDataSchema
} from '~/app/api/patch-submission/externalData'

const privateJson = (body: unknown) =>
  NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } })

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const user = await verifyHeaderCookie(req)
  if (!user) return privateJson('用户未登录')

  const parsedId = patchSubmissionIdSchema.safeParse({
    submissionId: (await params).id
  })
  if (!parsedId.success) return privateJson('投稿 ID 不正确')

  const input = await kunParsePostBody(req, patchSubmissionExternalDataSchema)
  if (typeof input === 'string') return privateJson(input)

  // Authorization precedes quota consumption, so invalid or foreign ids do not
  // burn the caller's external-fetch allowance.
  const accessError = await assertCanFetchPatchSubmissionExternalData(
    parsedId.data.submissionId,
    user.uid
  )
  if (accessError) return privateJson(accessError)

  const limited = await checkPatchSubmissionRateLimit(
    'external-fetch',
    user.uid
  )
  if (limited) return privateJson(limited)

  try {
    return privateJson(
      await fetchAndSavePatchSubmissionExternalData({
        submissionId: parsedId.data.submissionId,
        userId: user.uid,
        request: input
      })
    )
  } catch (error) {
    if (error instanceof PatchSubmissionError) {
      return privateJson(error.message)
    }
    if (error instanceof Error) {
      if (error.message === 'VNDB_NOT_FOUND') {
        return privateJson('未找到对应的 VNDB 条目')
      }
      if (error.message === 'BANGUMI_NOT_FOUND') {
        return privateJson('未找到对应的 Bangumi 条目')
      }
      if (error.message === 'DLSITE_PRODUCT_NOT_FOUND') {
        return privateJson('未找到该 DLSite 编号对应的作品')
      }
    }
    console.error('Failed to fetch patch submission external data', {
      submissionId: parsedId.data.submissionId,
      source: input.source,
      error
    })
    return privateJson('外部数据请求失败, 请稍后重试')
  }
}
