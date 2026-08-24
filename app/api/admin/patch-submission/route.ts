import { NextRequest, NextResponse } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { patchSubmissionAdminListSchema } from '~/validations/patchSubmission'
import { listAdminPatchSubmissions } from './service'

const privateJson = (body: unknown) =>
  NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } })

export const GET = async (req: NextRequest) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return privateJson('用户未登录')
  }

  const input = kunParseGetQuery(req, patchSubmissionAdminListSchema)
  if (typeof input === 'string') {
    return privateJson(input)
  }

  return privateJson(
    await listAdminPatchSubmissions({
      page: input.page,
      limit: input.limit,
      status: input.status,
      query: input.query,
      reviewerRole: payload.role
    })
  )
}
