import { NextRequest } from 'next/server'
import {
  kunParseDeleteQuery,
  kunParsePostBody,
  kunParsePutBody
} from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import {
  helpAnswerCreateSchema,
  helpAnswerIdSchema,
  helpAnswerUpdateSchema
} from '~/validations/help'
import {
  createHelpAnswer,
  deleteHelpAnswer,
  updateHelpAnswer
} from '../service'
import { helpJson } from '../response'

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, helpAnswerCreateSchema)
  if (typeof input === 'string') return helpJson(input)
  const payload = await verifyHeaderCookie(req)
  if (!payload) return helpJson('用户未登录')
  return helpJson(await createHelpAnswer(input, payload.uid))
}

export const PUT = async (req: NextRequest) => {
  const input = await kunParsePutBody(req, helpAnswerUpdateSchema)
  if (typeof input === 'string') return helpJson(input)
  const payload = await verifyHeaderCookie(req)
  if (!payload) return helpJson('用户未登录')
  return helpJson(await updateHelpAnswer(input, payload.uid))
}

export const DELETE = async (req: NextRequest) => {
  const input = kunParseDeleteQuery(req, helpAnswerIdSchema)
  if (typeof input === 'string') return helpJson(input)
  const payload = await verifyHeaderCookie(req)
  if (!payload) return helpJson('用户未登录')
  return helpJson(await deleteHelpAnswer(input.answerId, payload.uid))
}
