import { NextRequest, NextResponse } from 'next/server'
import { kunParseGetQuery, kunParsePostBody } from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { caseListSchema, createCaseSchema } from '~/validations/case'
import { createCase, listCases } from './service'

const privateJson = (body: unknown) =>
  NextResponse.json(body, {
    headers: { 'Cache-Control': 'private, no-store' }
  })

export const POST = async (req: NextRequest) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) return privateJson('用户未登录')
  const input = await kunParsePostBody(req, createCaseSchema)
  if (typeof input === 'string') return privateJson(input)
  return privateJson(await createCase(input, payload.uid))
}

export const GET = async (req: NextRequest) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) return privateJson('用户未登录')
  const input = kunParseGetQuery(req, caseListSchema)
  if (typeof input === 'string') return privateJson(input)
  return privateJson(await listCases(input, payload.uid, payload.role))
}
