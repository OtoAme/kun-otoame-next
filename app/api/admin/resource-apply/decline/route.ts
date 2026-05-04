import { NextRequest, NextResponse } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { kunParsePutBody } from '~/app/api/utils/parseQuery'
import { declinePatchResourceSchema } from '~/validations/admin'
import { declinePatchResource } from '../service'

export const PUT = async (req: NextRequest) => {
  const input = await kunParsePutBody(req, declinePatchResourceSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return NextResponse.json('未登录')
  }
  if (payload.role < 3) {
    return NextResponse.json('权限不足')
  }

  const response = await declinePatchResource(input, payload.uid)
  return NextResponse.json(response)
}
