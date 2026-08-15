import { NextRequest, NextResponse } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { adminStickerListSchema } from '~/validations/sticker'
import { getAdminStickerPacks } from './service'

const jsonPrivate = (body: unknown, status?: number) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' }
  })

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, adminStickerListSchema)
  if (typeof input === 'string') {
    return jsonPrivate(input)
  }

  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return jsonPrivate('用户未登录')
  }
  if (payload.role < 3) {
    return jsonPrivate('本页面仅管理员可访问')
  }

  return jsonPrivate(await getAdminStickerPacks(input.packId))
}
