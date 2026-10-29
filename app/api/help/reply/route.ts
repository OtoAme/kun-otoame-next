import { NextRequest } from 'next/server'
import {
  kunParseDeleteQuery,
  kunParsePostBody,
  kunParsePutBody
} from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import {
  helpReplyCreateSchema,
  helpReplyIdSchema,
  helpReplyUpdateSchema
} from '~/validations/help'
import { createHelpReply, deleteHelpReply, updateHelpReply } from '../service'
import { helpJson } from '../response'

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, helpReplyCreateSchema)
  if (typeof input === 'string') return helpJson(input)
  const payload = await verifyHeaderCookie(req)
  if (!payload) return helpJson('用户未登录')
  return helpJson(await createHelpReply(input, payload.uid))
}

export const PUT = async (req: NextRequest) => {
  const input = await kunParsePutBody(req, helpReplyUpdateSchema)
  if (typeof input === 'string') return helpJson(input)
  const payload = await verifyHeaderCookie(req)
  if (!payload) return helpJson('用户未登录')
  return helpJson(await updateHelpReply(input, payload.uid))
}

export const DELETE = async (req: NextRequest) => {
  const input = kunParseDeleteQuery(req, helpReplyIdSchema)
  if (typeof input === 'string') return helpJson(input)
  const payload = await verifyHeaderCookie(req)
  if (!payload) return helpJson('用户未登录')
  return helpJson(await deleteHelpReply(input.replyId, payload.uid))
}
