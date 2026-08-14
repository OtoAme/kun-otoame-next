import { NextRequest, NextResponse } from 'next/server'
import { PERSONALIZED_API_CACHE_CONTROL } from '~/app/api/utils/cacheHeaders'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { checkConversationActionRateLimit } from '../conversation/rateLimit'
import { getConversationRetryAfterSeconds } from '../conversation/response'
import { getStickerPacks } from './service'

const jsonNoStore = (
  body: unknown,
  init?: { status?: number; headers?: HeadersInit }
) =>
  NextResponse.json(body, {
    status: init?.status,
    headers: {
      'Cache-Control': PERSONALIZED_API_CACHE_CONTROL,
      ...init?.headers
    }
  })

export const GET = async (req: NextRequest) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return jsonNoStore('用户未登录')
  }

  const rateLimit = await checkConversationActionRateLimit(
    'message-read',
    payload.uid
  )
  if (!rateLimit.allowed) {
    return jsonNoStore(rateLimit.message, {
      status: 429,
      headers: {
        'Retry-After': getConversationRetryAfterSeconds(rateLimit.retryAfterMs)
      }
    })
  }

  const response = await getStickerPacks(payload.uid)
  return jsonNoStore(response)
}
