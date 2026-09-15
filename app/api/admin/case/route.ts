import { NextRequest } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { adminCaseListSchema } from '~/validations/case'
import { getAdminCases } from '~/app/api/case/service'
import { inboxJson } from '../inbox/response'

export const GET = async (req: NextRequest) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) return inboxJson('用户未登录')
  if (payload.role < 3) return inboxJson('本页面仅管理员可访问')
  const input = kunParseGetQuery(req, adminCaseListSchema)
  if (typeof input === 'string') return inboxJson(input)
  return inboxJson(await getAdminCases(input))
}
