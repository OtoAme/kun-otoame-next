import { NextRequest, NextResponse } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { PERSONALIZED_API_CACHE_CONTROL } from '~/app/api/utils/cacheHeaders'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { adminLogPaginationSchema } from '~/validations/admin'
import { getLog } from './service'

// The body depends on the viewer's role (masked below role 4), so no shared
// cache may keep it.
const privateJson = (body: unknown) =>
  NextResponse.json(body, {
    headers: { 'Cache-Control': PERSONALIZED_API_CACHE_CONTROL }
  })

export async function GET(req: NextRequest) {
  const input = kunParseGetQuery(req, adminLogPaginationSchema)
  if (typeof input === 'string') {
    return privateJson(input)
  }
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return privateJson('用户未登录')
  }
  // Module 09 plan 5.3: administrators read the management log.
  if (payload.role < 3) {
    return privateJson('本页面仅管理员可访问')
  }

  return privateJson(await getLog(input, payload.role))
}
