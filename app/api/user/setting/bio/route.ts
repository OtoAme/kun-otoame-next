import { NextRequest, NextResponse } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { bioSchema } from '~/validations/user'
import { updateBio } from './service'

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, bioSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return NextResponse.json('用户未登录')
  }

  const res = await updateBio(input.bio, payload.uid)
  return NextResponse.json(res)
}
