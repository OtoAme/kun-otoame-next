import { NextRequest, NextResponse } from 'next/server'
import {
  kunParseDeleteQuery,
  kunParsePostBody,
  kunParsePutBody
} from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { verifyKunCsrf } from '~/middleware/_csrf'
import {
  adminStickerPackCreateSchema,
  adminStickerPackDeleteSchema,
  adminStickerPackUpdateSchema
} from '~/validations/sticker'
import {
  createStickerPack,
  deleteStickerPack,
  updateStickerPack
} from '../service'

const jsonPrivate = (body: unknown, status?: number) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' }
  })

const verifyAdmin = async (req: NextRequest) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return '用户未登录' as const
  }
  if (payload.role < 3) {
    return '本页面仅管理员可访问' as const
  }
  return payload
}

export const POST = async (req: NextRequest) => {
  const csrfError = verifyKunCsrf(req)
  if (csrfError) {
    return jsonPrivate(csrfError, 403)
  }

  const input = await kunParsePostBody(req, adminStickerPackCreateSchema)
  if (typeof input === 'string') {
    return jsonPrivate(input)
  }
  const payload = await verifyAdmin(req)
  if (typeof payload === 'string') {
    return jsonPrivate(payload)
  }

  return jsonPrivate(await createStickerPack(input, payload.uid))
}

export const PUT = async (req: NextRequest) => {
  const csrfError = verifyKunCsrf(req)
  if (csrfError) {
    return jsonPrivate(csrfError, 403)
  }

  const input = await kunParsePutBody(req, adminStickerPackUpdateSchema)
  if (typeof input === 'string') {
    return jsonPrivate(input)
  }
  const payload = await verifyAdmin(req)
  if (typeof payload === 'string') {
    return jsonPrivate(payload)
  }

  return jsonPrivate(await updateStickerPack(input, payload.uid))
}

export const DELETE = async (req: NextRequest) => {
  const csrfError = verifyKunCsrf(req)
  if (csrfError) {
    return jsonPrivate(csrfError, 403)
  }

  const input = kunParseDeleteQuery(req, adminStickerPackDeleteSchema)
  if (typeof input === 'string') {
    return jsonPrivate(input)
  }
  const payload = await verifyAdmin(req)
  if (typeof payload === 'string') {
    return jsonPrivate(payload)
  }

  return jsonPrivate(await deleteStickerPack(input, payload.uid))
}
