import { NextRequest, NextResponse } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { PERSONALIZED_API_CACHE_CONTROL } from '~/app/api/utils/cacheHeaders'
import { createConversationSchema } from '~/validations/conversation'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { checkConversation } from '../service'
import { checkConversationActionRateLimit } from '../rateLimit'
import {
  getConversationRetryAfterSeconds,
  isConversationRateLimitResponse
} from '../response'

const jsonNoStore = (body: unknown) =>
  NextResponse.json(body, {
    headers: {
      'Cache-Control': PERSONALIZED_API_CACHE_CONTROL
    }
  })

const jsonConversationResponse = (body: unknown) => {
  if (isConversationRateLimitResponse(body)) {
    return NextResponse.json(body.message, {
      status: 429,
      headers: {
        'Cache-Control': PERSONALIZED_API_CACHE_CONTROL,
        'Retry-After': getConversationRetryAfterSeconds(body.retryAfterMs)
      }
    })
  }

  return jsonNoStore(body)
}

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, createConversationSchema)
  if (typeof input === 'string') {
    return jsonNoStore(input)
  }
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return jsonNoStore('用户未登录')
  }

  const rateLimit = await checkConversationActionRateLimit(
    'conversation-open',
    payload.uid
  )
  if (!rateLimit.allowed) {
    return jsonConversationResponse({
      kind: 'conversation-rate-limit',
      message: rateLimit.message,
      retryAfterMs: rateLimit.retryAfterMs
    })
  }

  const response = await checkConversation(input, payload.uid, payload.role)
  return jsonNoStore(response)
}
