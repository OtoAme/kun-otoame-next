import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import {
  LINK_HEALTH_ERRORS,
  LINK_HEALTH_CACHE_CONTROL
} from '~/constants/linkHealth'
import {
  kunParseDeleteQuery,
  kunParseGetQuery,
  kunParsePutBody
} from '~/app/api/utils/parseQuery'
import { adminResourcePaginationSchema } from '~/validations/admin'
import { getNSFWHeader } from '~/app/api/utils/getNSFWHeader'
import { getPatchResource } from './get'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { patchResourceStableUpdateSchema } from '~/validations/patch'
import { updatePatchResource } from './update'
import { deleteResource } from './delete'

const privateJson = (value: unknown, status?: number) => {
  const matched =
    typeof value === 'string'
      ? Object.values(LINK_HEALTH_ERRORS).find(
          (error) => error.message === value
        )
      : undefined
  return NextResponse.json(value, {
    status: status ?? matched?.status ?? 200,
    headers: { 'Cache-Control': LINK_HEALTH_CACHE_CONTROL }
  })
}

const resourceIdSchema = z.object({
  resourceId: z.coerce
    .number({ message: '资源 ID 必须为数字' })
    .min(1)
    .max(9999999)
})

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, adminResourcePaginationSchema)
  if (typeof input === 'string') {
    return privateJson(input)
  }
  const nsfwEnable = getNSFWHeader(req)
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return privateJson('用户未登录')
  }
  if (payload.role < 3) {
    return privateJson('本页面仅管理员可访问')
  }

  const res = await getPatchResource(input, nsfwEnable, {
    uid: payload.uid,
    role: payload.role
  })
  return privateJson(res)
}

export const PUT = async (req: NextRequest) => {
  const input = await kunParsePutBody(req, patchResourceStableUpdateSchema)
  if (typeof input === 'string') {
    return privateJson(LINK_HEALTH_ERRORS.invalid_request.message, 400)
  }
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return privateJson('用户未登录')
  }
  if (payload.role < 3) {
    return privateJson('本页面仅管理员可访问')
  }

  const response = await updatePatchResource(input, payload.uid)
  return privateJson(response)
}

export const DELETE = async (req: NextRequest) => {
  const input = kunParseDeleteQuery(req, resourceIdSchema)
  if (typeof input === 'string') {
    return privateJson(input)
  }
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return privateJson('用户未登录')
  }
  if (payload.role < 3) {
    return privateJson('本页面仅管理员可访问')
  }

  const response = await deleteResource(input, payload.uid)
  return privateJson(response)
}
