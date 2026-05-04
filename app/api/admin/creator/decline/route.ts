import { NextRequest, NextResponse } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { kunParsePutBody } from '~/app/api/utils/parseQuery'
import { declineCreatorSchema } from '~/validations/admin'
import { declineCreator } from '../service'

export const PUT = async (req: NextRequest) => {
  const input = await kunParsePutBody(req, declineCreatorSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return NextResponse.json('用户未登录')
  }
  if (payload.role < 4) {
    return NextResponse.json('本页面仅超级管理员可访问')
  }

  const response = await declineCreator(input, payload.uid)
  return NextResponse.json(response)
}
