'use server'

import { z } from 'zod'
import { safeParseSchema } from '~/utils/actions/safeParseSchema'
import { getMoemoepointLedger } from '~/app/api/moemoepoint/query'
import { canViewMoemoepointLedger } from '~/app/api/moemoepoint/access'
import {
  moemoepointLedgerQuerySchema,
  moemoepointUserIdSchema
} from '~/validations/moemoepoint'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'

/**
 * 后台查看任意用户的萌萌点流水。
 *
 * app/admin/layout.tsx 已经拦住了 role < 3, 但 server action 是独立入口,
 * 可以被直接调用, 所以这里必须自己再校验一次。
 */
export const getAdminMoemoepointLedgerAction = async (
  userId: number,
  params: z.infer<typeof moemoepointLedgerQuerySchema>
) => {
  const parsedUser = safeParseSchema(moemoepointUserIdSchema, { id: userId })
  if (typeof parsedUser === 'string') {
    return parsedUser
  }

  const payload = await verifyHeaderCookie()
  if (!payload) {
    return '请登录后查看萌萌点流水'
  }
  if (!canViewMoemoepointLedger(payload, parsedUser.id)) {
    return '您没有权限查看该用户的萌萌点流水'
  }

  const input = safeParseSchema(moemoepointLedgerQuerySchema, params)
  if (typeof input === 'string') {
    return input
  }

  return getMoemoepointLedger(parsedUser.id, input)
}
