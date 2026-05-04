import { NextRequest, NextResponse } from 'next/server'
import { kunParseGetQuery } from '../utils/parseQuery'
import { commentSchema } from '~/validations/comment'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { getComment } from './service'

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, commentSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return NextResponse.json('用户登陆失效')
  }

  const response = await getComment(input)
  return NextResponse.json(response)
}
