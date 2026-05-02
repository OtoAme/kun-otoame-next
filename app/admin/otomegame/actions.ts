'use server'

import { z } from 'zod'
import { safeParseSchema } from '~/utils/actions/safeParseSchema'
import { adminGalgamePaginationSchema } from '~/validations/admin'
import { getGalgame } from '~/app/api/admin/otomegame/service'
import { getNSFWHeader } from '~/utils/actions/getNSFWHeader'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'

export const kunGetActions = async (
  params: z.input<typeof adminGalgamePaginationSchema>
) => {
  const input = safeParseSchema(adminGalgamePaginationSchema, params)
  if (typeof input === 'string') {
    return input
  }
  const payload = await verifyHeaderCookie()
  if (!payload) {
    return '用户登陆失效'
  }
  if (payload.role < 3) {
    return '本页面仅管理员可访问'
  }

  const nsfwEnable = await getNSFWHeader()

  const response = await getGalgame(input, nsfwEnable)
  return response
}
