import { NextRequest, NextResponse } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { getUnreadMessageStatus } from '~/app/api/message/unread/service'
import { markConversationAsRead } from '../service'

export const PUT = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params
  const conversationId = parseInt(id, 10)
  if (isNaN(conversationId)) {
    return NextResponse.json('无效的会话 ID')
  }

  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return NextResponse.json('用户未登录')
  }

  const readResponse = await markConversationAsRead(conversationId, payload.uid)
  if (typeof readResponse === 'string') {
    return NextResponse.json(readResponse)
  }

  const response = await getUnreadMessageStatus(payload.uid)
  return NextResponse.json(response)
}
