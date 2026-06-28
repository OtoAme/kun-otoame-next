import { NextRequest, NextResponse } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { PERSONALIZED_API_CACHE_CONTROL } from '~/app/api/utils/cacheHeaders'
import { getUnreadStatus } from '../service'

const jsonNoStore = (body: unknown) =>
  NextResponse.json(body, {
    headers: {
      'Cache-Control': PERSONALIZED_API_CACHE_CONTROL
    }
  })

export const GET = async (req: NextRequest) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return jsonNoStore('用户未登录')
  }

  const response = await getUnreadStatus(payload.uid)
  return jsonNoStore(response)
}
