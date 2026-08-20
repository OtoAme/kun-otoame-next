import { NextRequest, NextResponse } from 'next/server'
import { kunParsePutBody } from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { checkConversationActionRateLimit } from '~/app/api/message/conversation/rateLimit'
import { commentIdSchema, toggleCommentLike } from './service'

export const PUT = async (req: NextRequest) => {
  const input = await kunParsePutBody(req, commentIdSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return NextResponse.json('用户未登录')
  }

  const rateLimit = await checkConversationActionRateLimit(
    'patch-like',
    payload.uid
  )
  if (!rateLimit.allowed) {
    return NextResponse.json(rateLimit.message)
  }

  const response = await toggleCommentLike(input, payload.uid)
  return NextResponse.json(response)
}
