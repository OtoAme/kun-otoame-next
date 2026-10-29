import { NextRequest } from 'next/server'
import { z } from 'zod'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { helpAnswerIdSchema, helpToggleSchema } from '~/validations/help'
import { setHelpAnswerUseful } from '../service'
import { helpJson } from '../response'

const schema = z.object({
  ...helpAnswerIdSchema.shape,
  ...helpToggleSchema.shape
})

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, schema)
  if (typeof input === 'string') return helpJson(input)
  const payload = await verifyHeaderCookie(req)
  if (!payload) return helpJson('用户未登录')
  return helpJson(
    await setHelpAnswerUseful(input.answerId, input.active, payload.uid)
  )
}
