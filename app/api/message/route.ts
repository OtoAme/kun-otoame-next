import { NextRequest, NextResponse } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { PERSONALIZED_API_CACHE_CONTROL } from '~/app/api/utils/cacheHeaders'
import { createMessageSchema } from '~/validations/message'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { create } from './service'
import { NotificationServiceError } from './error'

const jsonNoStore = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': PERSONALIZED_API_CACHE_CONTROL
    }
  })

export const POST = async (req: NextRequest) => {
  try {
    const payload = await verifyHeaderCookie(req)
    if (!payload) return jsonNoStore('用户未登录', 401)
    if (payload.role < 3) return jsonNoStore('权限不足', 403)

    const input = await kunParsePostBody(req, createMessageSchema)
    if (typeof input === 'string') return jsonNoStore(input, 400)

    return jsonNoStore(await create(input, payload.uid))
  } catch (error) {
    return jsonNoStore(
      {
        code:
          error instanceof NotificationServiceError
            ? error.code
            : 'NOTIFICATION_UNAVAILABLE',
        message:
          error instanceof NotificationServiceError
            ? error.message
            : '通知服务暂不可用，请稍后重试'
      },
      error instanceof NotificationServiceError ? error.status : 503
    )
  }
}
