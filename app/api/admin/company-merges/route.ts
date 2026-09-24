import { NextRequest } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { listCompanyMergeSuggestionsSchema } from '~/validations/companyMerges'
import { companyMergeJson } from './response'
import { listCompanyMergeSuggestions } from './service'

export const GET = async (req: NextRequest) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) return companyMergeJson('用户未登录')
  if (payload.role < 3) return companyMergeJson('本页面仅管理员可访问')

  const input = kunParseGetQuery(req, listCompanyMergeSuggestionsSchema)
  if (typeof input === 'string') return companyMergeJson(input)

  return companyMergeJson(await listCompanyMergeSuggestions(input.status))
}
