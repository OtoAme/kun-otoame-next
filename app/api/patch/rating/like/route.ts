import { NextRequest, NextResponse } from 'next/server'
import { kunParsePutBody } from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { ratingIdSchema, toggleRatingLike } from './service'

export const PUT = async (req: NextRequest) => {
  const input = await kunParsePutBody(req, ratingIdSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return NextResponse.json('请先登录')
  }

  const response = await toggleRatingLike(input, payload.uid)
  return NextResponse.json(response)
}
