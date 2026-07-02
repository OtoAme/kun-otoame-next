import { NextRequest, NextResponse } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { PERSONALIZED_API_CACHE_CONTROL } from '~/app/api/utils/cacheHeaders'
import { createMessageSchema } from '~/validations/message'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { create } from './service'

const jsonNoStore = (body: unknown) =>
  NextResponse.json(body, {
    headers: {
      'Cache-Control': PERSONALIZED_API_CACHE_CONTROL
    }
  })

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, createMessageSchema)
  if (typeof input === 'string') {
    return jsonNoStore(input)
  }
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return jsonNoStore('用户未登录')
  }
  if (payload.role < 3) {
    return jsonNoStore('权限不足')
  }

  const response = await create(input, payload.uid)
  return jsonNoStore(response)
}
