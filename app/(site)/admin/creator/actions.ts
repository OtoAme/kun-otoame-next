'use server'

import { z } from 'zod'
import { safeParseSchema } from '~/utils/actions/safeParseSchema'
import { adminCreatorPaginationSchema } from '~/validations/admin'
import { getAdminCreator } from '~/app/api/admin/creator/service'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'

export const kunGetActions = async (
  params: z.input<typeof adminCreatorPaginationSchema>
) => {
  // The legacy page has always listed applications of every status.
  const input = safeParseSchema(adminCreatorPaginationSchema, {
    status: 'all',
    ...params
  })
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

  const response = await getAdminCreator(input)
  return response
}
