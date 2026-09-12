import { NextRequest, NextResponse } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { getPatchVisibilityWhere } from '~/app/api/utils/getPatchVisibilityWhere'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { shoutboxProfileSchema } from '~/validations/shoutbox'
import { getUserShoutboxes } from '~/app/api/shoutbox/service'

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, shoutboxProfileSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input, {
      headers: { 'Cache-Control': 'private, no-store' }
    })
  }
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return NextResponse.json('用户未登录', {
      headers: { 'Cache-Control': 'private, no-store' }
    })
  }
  const response = await getUserShoutboxes(input, payload, {
    visibilityWhere: await getPatchVisibilityWhere(req)
  })
  return NextResponse.json(response, {
    headers: { 'Cache-Control': 'private, no-store' }
  })
}
