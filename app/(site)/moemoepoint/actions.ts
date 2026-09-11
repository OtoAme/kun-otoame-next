'use server'

import { z } from 'zod'
import { safeParseSchema } from '~/utils/actions/safeParseSchema'
import { getMoemoepointLedger } from '~/app/api/moemoepoint/query'
import { canViewMoemoepointLedger } from '~/app/api/moemoepoint/access'
import { moemoepointLedgerQuerySchema } from '~/validations/moemoepoint'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'

/**
 * 只读取登录用户自己的萌萌点明细。这个 action 不接受 userId 参数 ——
 * 管理员查看他人明细走后台 /admin/user/[id]/moemoepoint。
 */
export const getMyMoemoepointLedgerAction = async (
  params: z.infer<typeof moemoepointLedgerQuerySchema>
) => {
  const payload = await verifyHeaderCookie()
  if (!payload) {
    return '请登录后查看萌萌点明细'
  }

  const input = safeParseSchema(moemoepointLedgerQuerySchema, params)
  if (typeof input === 'string') {
    return input
  }

  // 本人查自己永远成立, 这里保留判断是为了让权限来源只有一处。
  if (!canViewMoemoepointLedger(payload, payload.uid)) {
    return '您没有权限查看萌萌点明细'
  }

  return getMoemoepointLedger(payload.uid, input)
}
