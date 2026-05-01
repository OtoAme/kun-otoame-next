import { NextRequest, NextResponse } from 'next/server'
import { kunParseFormData } from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { avatarSchema } from '~/validations/user'
import { updateUserAvatar } from './service'

export const POST = async (req: NextRequest) => {
  const input = await kunParseFormData(req, avatarSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return NextResponse.json('用户未登录')
  }

  const avatar = await new Response(input.avatar)?.arrayBuffer()

  const res = await updateUserAvatar(payload.uid, avatar)
  return NextResponse.json(res)
}
