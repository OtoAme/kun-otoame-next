import { NextRequest } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { helpAcceptSchema } from '~/validations/help'
import { acceptHelpAnswer } from '../service'
import { helpJson } from '../response'

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, helpAcceptSchema)
  if (typeof input === 'string') return helpJson(input)
  const payload = await verifyHeaderCookie(req)
  if (!payload) return helpJson('用户未登录')
  return helpJson(await acceptHelpAnswer(input, payload.uid))
}
