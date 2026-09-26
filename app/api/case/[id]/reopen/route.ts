import { NextRequest } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { caseIdParamSchema, reopenCaseBodySchema } from '~/validations/case'
import { reopenCase } from '../../service'
import { inboxJson } from '~/app/api/admin/inbox/response'

const getId = (raw: string) => {
  const parsed = caseIdParamSchema.safeParse({ id: raw })
  return parsed.success ? parsed.data.id : null
}

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) return inboxJson('用户未登录')
  const id = getId((await params).id)
  if (id === null) return inboxJson('问题 ID 格式不正确')
  const body = await kunParsePostBody(req, reopenCaseBodySchema)
  if (typeof body === 'string') return inboxJson(body)
  return inboxJson(await reopenCase(id, payload.uid, body.content))
}
