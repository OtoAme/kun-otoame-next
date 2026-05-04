import { NextRequest, NextResponse } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { parseCookies } from '~/utils/cookies'
import { verify2FA } from '~/app/api/utils/verify2FA'
import { verifyLogin2FASchema } from '~/validations/auth'
import { verifyLogin2FA } from './service'

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, verifyLogin2FASchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }
  const tempToken = parseCookies(req.headers.get('cookie') ?? '')[
    'kun-galgame-patch-moe-2fa-token'
  ]
  if (!tempToken) {
    return NextResponse.json('未找到临时令牌')
  }
  const payload = verify2FA(tempToken)
  if (!payload) {
    return NextResponse.json('2FA 临时令牌已过期, 时效为 10 分钟')
  }

  const response = await verifyLogin2FA(input, tempToken, payload.id)
  return NextResponse.json(response)
}
