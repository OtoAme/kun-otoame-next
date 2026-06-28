import { NextRequest, NextResponse } from 'next/server'
import { kunParseDeleteQuery } from '~/app/api/utils/parseQuery'
import { PERSONALIZED_API_CACHE_CONTROL } from '~/app/api/utils/cacheHeaders'
import { clearReadMessageSchema } from '~/validations/message'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { clearReadMessage, readMessage } from '../service'
import { getUnreadMessageStatus } from '../unread/service'

const jsonNoStore = (body: unknown) =>
  NextResponse.json(body, {
    headers: {
      'Cache-Control': PERSONALIZED_API_CACHE_CONTROL
    }
  })

export const PUT = async (req: NextRequest) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return jsonNoStore('用户未登录')
  }

  await readMessage(payload.uid)
  const response = await getUnreadMessageStatus(payload.uid)
  return jsonNoStore(response)
}

export const DELETE = async (req: NextRequest) => {
  const input = kunParseDeleteQuery(req, clearReadMessageSchema)
  if (typeof input === 'string') {
    return jsonNoStore(input)
  }

  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return jsonNoStore('用户未登录')
  }

  const response = await clearReadMessage(payload.uid, input.type)
  return jsonNoStore(response)
}
