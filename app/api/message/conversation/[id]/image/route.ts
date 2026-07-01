import { NextRequest, NextResponse } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { verifyKunCsrf } from '~/middleware/_csrf'
import { PERSONALIZED_API_CACHE_CONTROL } from '~/app/api/utils/cacheHeaders'
import { uploadConversationImage } from './service'
import {
  createConversationRateLimitResponse,
  getConversationRetryAfterSeconds,
  isConversationRateLimitResponse
} from '../../response'
import { parseConversationRouteId } from '../../routeParams'

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

const jsonConversationImageResponse = (body: unknown) => {
  if (isConversationRateLimitResponse(body)) {
    return jsonNoStore(body.message, {
      status: 429,
      headers: {
        'Retry-After': getConversationRetryAfterSeconds(body.retryAfterMs)
      }
    })
  }

  return jsonNoStore(body)
}

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const csrfError = verifyKunCsrf(req)
  if (csrfError) {
    return jsonNoStore(csrfError)
  }

  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return jsonNoStore('用户未登录')
  }

  const { id } = await params
  const conversationId = parseConversationRouteId(id)
  if (conversationId === null) {
    return jsonNoStore('无效的会话 ID')
  }

  const { checkConversationActionRateLimit } = await import('../../rateLimit')
  const intakeRateLimit = await checkConversationActionRateLimit(
    'image-upload-intake',
    payload.uid
  )
  if (!intakeRateLimit.allowed) {
    return jsonConversationImageResponse(
      createConversationRateLimitResponse(
        intakeRateLimit.message,
        intakeRateLimit.retryAfterMs
      )
    )
  }

  const formData = await req.formData()
  const image = formData.get('image')
  if (!(image instanceof File)) {
    return jsonNoStore('请上传图片')
  }

  const response = await uploadConversationImage(
    conversationId,
    image,
    payload.uid
  )
  return jsonConversationImageResponse(response)
}
