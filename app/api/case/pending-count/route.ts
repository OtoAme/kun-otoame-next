import { NextRequest } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { getPendingCaseCounts } from '../service'
import { inboxJson } from '~/app/api/admin/inbox/response'

export const GET = async (req: NextRequest) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) return inboxJson('用户未登录')
  return inboxJson(await getPendingCaseCounts(payload.uid))
}
