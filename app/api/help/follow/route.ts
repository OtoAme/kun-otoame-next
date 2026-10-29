import { NextRequest } from 'next/server'
import { z } from 'zod'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { helpPostIdSchema, helpToggleSchema } from '~/validations/help'
import { setHelpFollow } from '../service'
import { helpJson } from '../response'

const schema = z.object({
  ...helpPostIdSchema.shape,
  ...helpToggleSchema.shape
})

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, schema)
  if (typeof input === 'string') return helpJson(input)
  const payload = await verifyHeaderCookie(req)
  if (!payload) return helpJson('用户未登录')
  return helpJson(await setHelpFollow(input.postId, input.active, payload.uid))
}
