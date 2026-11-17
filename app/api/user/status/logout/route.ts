import { NextRequest, NextResponse } from 'next/server'
import { deleteKunSession } from '~/app/api/utils/jwt'
import { getRequestIdentity } from '~/app/api/utils/sessionIdentity'
import { clearSessionCookies } from '~/app/api/utils/sessionCookies'

export async function POST(req: NextRequest) {
  const identity = await getRequestIdentity(req)
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
