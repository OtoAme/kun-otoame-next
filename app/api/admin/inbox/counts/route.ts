import { NextRequest } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { getAdminInboxCounts } from '../service'
import { inboxJson } from '../response'

export const GET = async (req: NextRequest) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) return inboxJson('用户未登录')
  if (payload.role < 3) return inboxJson('本页面仅管理员可访问')

  return inboxJson(await getAdminInboxCounts(payload.uid))
}
