import { NextRequest, NextResponse } from 'next/server'
import { kunParseDeleteBody, kunParsePutBody } from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { verifyKunCsrf } from '~/middleware/_csrf'
import {
  adminStickerDeleteSchema,
  adminStickerStatusRequestSchema
} from '~/validations/sticker'
import {
  deleteStickers,
  updateStickerStatus,
  updateStickerStatuses
} from '../service'

const jsonPrivate = (body: unknown, status?: number) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' }
  })

export const PUT = async (req: NextRequest) => {
  const csrfError = verifyKunCsrf(req)
  if (csrfError) {
    return jsonPrivate(csrfError, 403)
  }

  const input = await kunParsePutBody(req, adminStickerStatusRequestSchema)
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

  return jsonPrivate(
    await ('stickerIds' in input
      ? updateStickerStatuses(input, payload.uid)
      : updateStickerStatus(input, payload.uid))
  )
}

export const DELETE = async (req: NextRequest) => {
  const csrfError = verifyKunCsrf(req)
  if (csrfError) {
    return jsonPrivate(csrfError, 403)
  }

  const input = await kunParseDeleteBody(req, adminStickerDeleteSchema)
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

  return jsonPrivate(await deleteStickers(input, payload.uid))
}
