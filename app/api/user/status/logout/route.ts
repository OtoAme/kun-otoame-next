import { NextRequest, NextResponse } from 'next/server'
import { deleteKunSession } from '~/app/api/utils/jwt'
import { PERSONALIZED_API_CACHE_CONTROL } from '~/app/api/utils/cacheHeaders'
import {
  getRequestIdentity,
  getSessionContext
} from '~/app/api/utils/sessionIdentity'
import { clearSessionCookies } from '~/app/api/utils/sessionCookies'

export async function POST(req: NextRequest) {
  const identity = await getRequestIdentity(req)
  const input = await req.json().catch(() => null)
  if (
    identity.status === 'authenticated' &&
    (typeof input?.context !== 'string' ||
      input.context !== getSessionContext(identity.payload))
  ) {
    return NextResponse.json(
      {
        code: 'SESSION_CHANGED',
        revoked: false,
        message: '登录状态已变化，请重新确认当前账号后重试退出'
      },
      {
        status: 409,
        headers: { 'Cache-Control': PERSONALIZED_API_CACHE_CONTROL }
      }
    )
  }
  let revoked = identity.status !== 'unavailable'
  if (identity.status === 'authenticated') {
    try {
      await deleteKunSession(identity.payload.uid, identity.payload.jti)
    } catch {
      revoked = false
    }
  }
  return clearSessionCookies(
    NextResponse.json(
      {
        revoked,
        message: revoked
          ? '退出登录成功'
          : '已清理本机登录，服务端会话撤销暂未确认'
      },
      { status: revoked ? 200 : 503 }
    )
  )
}
