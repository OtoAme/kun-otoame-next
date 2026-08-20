import { NextRequest, NextResponse } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { PERSONALIZED_API_CACHE_CONTROL } from '~/app/api/utils/cacheHeaders'
import { getMoemoepointLedger } from '~/app/api/moemoepoint/query'
import { canViewMoemoepointLedger } from '~/app/api/moemoepoint/access'
import {
  moemoepointLedgerQuerySchema,
  moemoepointUserIdSchema
} from '~/validations/moemoepoint'

export const dynamic = 'force-dynamic'

const jsonNoStore = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': PERSONALIZED_API_CACHE_CONTROL }
  })

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return jsonNoStore('用户未登录', 401)
  }

  const { id } = await params
  const parsedUser = moemoepointUserIdSchema.safeParse({ id })
  if (!parsedUser.success) {
    return jsonNoStore('用户 ID 不合法', 400)
  }
  if (!canViewMoemoepointLedger(payload, parsedUser.data.id)) {
    return jsonNoStore('您没有权限查看该用户的萌萌点流水', 403)
  }

  const input = kunParseGetQuery(req, moemoepointLedgerQuerySchema)
  if (typeof input === 'string') {
    return jsonNoStore(input, 400)
  }

  const result = await getMoemoepointLedger(parsedUser.data.id, input)
  if (typeof result === 'string') {
    return jsonNoStore(result, 404)
  }
  return jsonNoStore(result)
}
