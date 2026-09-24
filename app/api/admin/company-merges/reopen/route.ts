import { NextRequest } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { reopenCompanyMergeSuggestionSchema } from '~/validations/companyMerges'
import { companyMergeJson } from '../response'
import { reopenCompanyMergeSuggestion } from '../service'

export const POST = async (req: NextRequest) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) return companyMergeJson('用户未登录')
  if (payload.role < 3) return companyMergeJson('本页面仅管理员可访问')

  const input = await kunParsePostBody(req, reopenCompanyMergeSuggestionSchema)
  if (typeof input === 'string') return companyMergeJson(input)

  return companyMergeJson(await reopenCompanyMergeSuggestion(input.id))
}
