import { NextRequest, NextResponse } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { createPatchFeedbackSchema } from '~/validations/patch'
import { createFeedback } from './service'

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, createPatchFeedbackSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return NextResponse.json('用户未登录')
  }

  const response = await createFeedback(input, payload.uid)
  return NextResponse.json(response)
}
