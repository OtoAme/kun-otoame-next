import { NextRequest, NextResponse } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { verifyKunCsrf } from '~/middleware/_csrf'
import { PERSONALIZED_API_CACHE_CONTROL } from '~/app/api/utils/cacheHeaders'
import {
  PRIVATE_MESSAGE_IMAGE_SIZE_LIMIT_MESSAGE,
  uploadConversationImage
} from './service'
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

  if (body === PRIVATE_MESSAGE_IMAGE_SIZE_LIMIT_MESSAGE) {
    return jsonNoStore(body, { status: 413 })
  }

  return jsonNoStore(body)
}

const MIDDLEWARE_CLIENT_MAX_BODY_SIZE_BYTES = 10 * 1024 * 1024

const getRequestContentLength = (req: NextRequest) => {
  const contentLength = req.headers.get('content-length')
  if (!contentLength) {
    return null
  }

  const parsed = Number(contentLength)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

const isRequestBodyOverMiddlewareClientLimit = (req: NextRequest) => {
  const contentLength = getRequestContentLength(req)
  return (
    contentLength !== null &&
    contentLength > MIDDLEWARE_CLIENT_MAX_BODY_SIZE_BYTES
  )
}

const isMultipartSizeError = (error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''

  return /too large|exceed|exceeded|limit|maximum|payload|content-length|entity too large|body size|request body size|图片.*(过大|超过|大小)/i.test(
    message
  )
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

  if (isRequestBodyOverMiddlewareClientLimit(req)) {
    return jsonNoStore(PRIVATE_MESSAGE_IMAGE_SIZE_LIMIT_MESSAGE, {
      status: 413
    })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch (error) {
    const isSizeError =
      isMultipartSizeError(error) || isRequestBodyOverMiddlewareClientLimit(req)
    return jsonNoStore(
      isSizeError
        ? PRIVATE_MESSAGE_IMAGE_SIZE_LIMIT_MESSAGE
        : '图片上传请求解析失败，请稍后重试',
      { status: isSizeError ? 413 : 400 }
    )
  }

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
