import { NextRequest } from 'next/server'
import { getPatchVisibilityWhere } from '~/app/api/utils/getPatchVisibilityWhere'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { helpSidebarSchema } from '~/validations/help'
import { getHelpSidebar } from '../service'
import { helpJson } from '../response'

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, helpSidebarSchema)
  if (typeof input === 'string') return helpJson(input)
  const payload = await verifyHeaderCookie(req)
  return helpJson(
    await getHelpSidebar(
      payload ? { uid: payload.uid, role: payload.role } : null,
      await getPatchVisibilityWhere(req),
      { status: input.status, scope: input.scope }
    )
  )
}
