import { NextRequest, NextResponse } from 'next/server'
import { LINK_HEALTH_CACHE_CONTROL } from '~/constants/linkHealth'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { adminPaginationSchema } from '~/validations/admin'
import { getNSFWHeader } from '~/app/api/utils/getNSFWHeader'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { getPatchResourceApply } from './get'

const privateJson = (value: unknown) =>
  NextResponse.json(value, {
    headers: { 'Cache-Control': LINK_HEALTH_CACHE_CONTROL }
  })

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, adminPaginationSchema)
  if (typeof input === 'string') {
    return privateJson(input)
  }

  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return privateJson('未登录')
  }
  if (payload.role < 3) {
    return privateJson('权限不足')
  }

  const nsfwEnable = getNSFWHeader(req)

  const res = await getPatchResourceApply(input, nsfwEnable, {
    uid: payload.uid,
    role: payload.role
  })
  return privateJson(res)
}
