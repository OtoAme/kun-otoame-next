import { NextRequest } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { companyMergeJson } from './response'
import { listCompanyMergeSuggestions } from './service'

export const GET = async (req: NextRequest) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) return companyMergeJson('用户未登录')
  if (payload.role < 3) return companyMergeJson('本页面仅管理员可访问')

  return companyMergeJson(await listCompanyMergeSuggestions())
}
