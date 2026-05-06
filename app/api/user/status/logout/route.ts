import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { deleteKunSession } from '~/app/api/utils/jwt'

export async function POST(req: NextRequest) {
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return NextResponse.json('用户未登录')
  }

  await deleteKunSession(payload.uid, payload.jti)
  const cookie = await cookies()
  cookie.delete('kun-galgame-patch-moe-token')

  return NextResponse.json({ message: '退出登录成功' })
}
