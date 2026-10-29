import { NextRequest } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { getPatchVisibilityWhere } from '~/app/api/utils/getPatchVisibilityWhere'
import { helpListSchema } from '~/validations/help'
import { listHelpPosts } from './service'
import { helpJson } from './response'

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, helpListSchema)
  if (typeof input === 'string') return helpJson(input)
  const payload = input.scope === 'all' ? null : await verifyHeaderCookie(req)
  if (input.scope !== 'all' && !payload) return helpJson('请先登录')
  return helpJson(
    await listHelpPosts(input, await getPatchVisibilityWhere(req), {
      viewer: payload ? { uid: payload.uid, role: payload.role } : null
    })
  )
}
