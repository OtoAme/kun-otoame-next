import { NextRequest, NextResponse } from 'next/server'
import {
  kunParsePostBody,
  kunParseGetQuery,
  kunParsePutBody
} from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import {
  adminShoutboxCreateSchema,
  adminShoutboxListSchema,
  adminShoutboxUpdateSchema
} from '~/validations/shoutbox'
import {
  createOfficialShoutbox,
  getAdminShoutboxList,
  getAdminOfficialShoutboxes,
  updateOfficialShoutbox
} from './service'

const privateJson = (body: unknown) =>
  NextResponse.json(body, {
    headers: { 'Cache-Control': 'private, no-store' }
  })

const getAdmin = async (req: NextRequest) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) return '用户未登录'
  if (payload.role < 3) return '本页面仅管理员可访问'
  return payload
}

export const POST = async (req: NextRequest) => {
  const auth = await getAdmin(req)
  if (typeof auth === 'string') return privateJson(auth)
  const input = await kunParsePostBody(req, adminShoutboxCreateSchema)
  if (typeof input === 'string') return privateJson(input)
  return privateJson(
    await createOfficialShoutbox(input, auth.uid, { adminRole: auth.role })
  )
}

export const GET = async (req: NextRequest) => {
  const auth = await getAdmin(req)
  if (typeof auth === 'string') return privateJson(auth)
  const input = kunParseGetQuery(req, adminShoutboxListSchema)
  if (typeof input === 'string') return privateJson(input)
  if (input.tab === 'official') {
    return privateJson(
      await getAdminOfficialShoutboxes(input, { adminRole: auth.role })
    )
  }
  return privateJson(
    await getAdminShoutboxList(input, { adminRole: auth.role })
  )
}

export const PUT = async (req: NextRequest) => {
  const auth = await getAdmin(req)
  if (typeof auth === 'string') return privateJson(auth)
  const input = await kunParsePutBody(req, adminShoutboxUpdateSchema)
  if (typeof input === 'string') return privateJson(input)
  return privateJson(
    await updateOfficialShoutbox(input, auth.uid, { adminRole: auth.role })
  )
}
