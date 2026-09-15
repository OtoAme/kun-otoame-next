import { NextRequest } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { caseIdParamSchema } from '~/validations/case'
import { getAdminCaseDetail } from '~/app/api/case/service'
import { inboxJson } from '../../inbox/response'

const getId = (raw: string) => {
  const parsed = caseIdParamSchema.safeParse({ id: raw })
  return parsed.success ? parsed.data.id : null
}

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) return inboxJson('用户未登录')
  if (payload.role < 3) return inboxJson('本页面仅管理员可访问')
  const id = getId((await params).id)
  if (id === null) return inboxJson('问题 ID 格式不正确')
  return inboxJson(await getAdminCaseDetail(id, payload.uid, payload.role))
}
