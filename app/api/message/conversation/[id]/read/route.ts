import { NextRequest, NextResponse } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { PERSONALIZED_API_CACHE_CONTROL } from '~/app/api/utils/cacheHeaders'
import { getUnreadMessageStatus } from '~/app/api/message/unread/service'
import { markConversationAsRead } from '../service'

const jsonNoStore = (body: unknown) =>
  NextResponse.json(body, {
    headers: {
      'Cache-Control': PERSONALIZED_API_CACHE_CONTROL
    }
  })

export const PUT = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params
  const conversationId = parseInt(id, 10)
  if (isNaN(conversationId)) {
    return jsonNoStore('无效的会话 ID')
  }

  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return jsonNoStore('用户未登录')
  }

  const readResponse = await markConversationAsRead(conversationId, payload.uid)
  if (typeof readResponse === 'string') {
    return jsonNoStore(readResponse)
  }

  const response = await getUnreadMessageStatus(payload.uid)
  return jsonNoStore(response)
}
