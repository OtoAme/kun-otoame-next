import { NextRequest, NextResponse } from 'next/server'
import { PERSONALIZED_API_CACHE_CONTROL } from '~/app/api/utils/cacheHeaders'
import { kunParseGetQuery, kunParsePostBody } from '~/app/api/utils/parseQuery'
import {
  getConversationsSchema,
  createConversationSchema
} from '~/validations/conversation'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { getConversations, getOrCreateConversation } from './service'

const jsonNoStore = (body: unknown) =>
  NextResponse.json(body, {
    headers: {
      'Cache-Control': PERSONALIZED_API_CACHE_CONTROL
    }
  })

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, getConversationsSchema)
  if (typeof input === 'string') {
    return jsonNoStore(input)
  }
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return jsonNoStore('用户未登录')
  }

  const response = await getConversations(input, payload.uid)
  return jsonNoStore(response)
}

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, createConversationSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return NextResponse.json('用户未登录')
  }

  const response = await getOrCreateConversation(
    input,
    payload.uid,
    payload.role
  )
  return NextResponse.json(response)
}
