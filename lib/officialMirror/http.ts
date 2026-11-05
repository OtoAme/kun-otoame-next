import { NextResponse } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import type { NextRequest } from 'next/server'

export const officialMirrorJson = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'CDN-Cache-Control': 'no-store',
      Vary: 'Cookie'
    }
  })

export const requireMirrorAdmin = async (req: NextRequest) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) return { error: '用户未登录' as const }
  if (payload.role < 3) return { error: '本页面仅管理员可访问' as const }
  return { uid: payload.uid, role: payload.role }
}

export const withMirrorAdmin = async (
  req: NextRequest,
  run: (actorId: number) => Promise<unknown>
) => {
  const admin = await requireMirrorAdmin(req)
  if ('error' in admin) return officialMirrorJson(admin.error)
  return officialMirrorJson(await run(admin.uid))
}
