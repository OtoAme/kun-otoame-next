'use server'

import { z } from 'zod'
import { safeParseSchema } from '~/utils/actions/safeParseSchema'
import { getMoemoepointLedger } from '~/app/api/moemoepoint/query'
import {
  moemoepointLedgerQuerySchema,
  moemoepointUserIdSchema
} from '~/validations/moemoepoint'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'

export const getMoemoepointLedgerAction = async (
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
  if (payload.uid !== parsedUser.id && payload.role < 3) {
    return '您没有权限查看该用户的萌萌点流水'
  }

  const input = safeParseSchema(moemoepointLedgerQuerySchema, params)
  if (typeof input === 'string') {
    return input
  }
  return getMoemoepointLedger(parsedUser.id, input)
}
