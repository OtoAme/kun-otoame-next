import { NextRequest } from 'next/server'
import {
  kunParseDeleteQuery,
  kunParseGetQuery,
  kunParsePostBody,
  kunParsePutBody
} from '~/app/api/utils/parseQuery'
import { getPatchVisibilityWhere } from '~/app/api/utils/getPatchVisibilityWhere'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import {
  helpPostCreateSchema,
  helpPostIdSchema,
  helpPostUpdateSchema
} from '~/validations/help'
import {
  createHelpPost,
  deleteHelpPost,
  getHelpPost,
  updateHelpPost
} from '../service'
import { helpJson } from '../response'

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, helpPostIdSchema)
  if (typeof input === 'string') return helpJson(input)
  const payload = await verifyHeaderCookie(req)
  return helpJson(
    await getHelpPost(
      input.postId,
      payload ? { uid: payload.uid, role: payload.role } : null,
      await getPatchVisibilityWhere(req)
    )
  )
}

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, helpPostCreateSchema)
  if (typeof input === 'string') return helpJson(input)
  const payload = await verifyHeaderCookie(req)
  if (!payload) return helpJson('用户未登录')
  return helpJson(await createHelpPost(input, payload.uid))
}

export const PUT = async (req: NextRequest) => {
  const input = await kunParsePutBody(req, helpPostUpdateSchema)
  if (typeof input === 'string') return helpJson(input)
  const payload = await verifyHeaderCookie(req)
  if (!payload) return helpJson('用户未登录')
  return helpJson(await updateHelpPost(input, payload.uid))
}

export const DELETE = async (req: NextRequest) => {
  const input = kunParseDeleteQuery(req, helpPostIdSchema)
  if (typeof input === 'string') return helpJson(input)
  const payload = await verifyHeaderCookie(req)
  if (!payload) return helpJson('用户未登录')
  return helpJson(await deleteHelpPost(input.postId, payload.uid))
}
