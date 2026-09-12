import { NextRequest, NextResponse } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { adminShoutboxModerateSchema } from '~/validations/shoutbox'
import { moderateShoutbox } from '../service'

const privateJson = (body: unknown) =>
  NextResponse.json(body, {
    headers: { 'Cache-Control': 'private, no-store' }
  })

export const POST = async (req: NextRequest) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) return privateJson('用户未登录')
  if (payload.role < 3) return privateJson('本页面仅管理员可访问')

  const input = await kunParsePostBody(req, adminShoutboxModerateSchema)
  if (typeof input === 'string') return privateJson(input)

  return privateJson(
    await moderateShoutbox(input, payload.uid, { adminRole: payload.role })
  )
}
