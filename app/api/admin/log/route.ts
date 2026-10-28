import { NextRequest, NextResponse } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { adminLogPaginationSchema } from '~/validations/admin'
import { getLog } from './service'

export async function GET(req: NextRequest) {
  const input = kunParseGetQuery(req, adminLogPaginationSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return NextResponse.json('用户未登录')
  }
  // Module 09 plan 5.3: administrators read the management log.
  if (payload.role < 3) {
    return NextResponse.json('本页面仅管理员可访问')
  }

  const res = await getLog(input)
  return NextResponse.json(res)
}
