import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import { adminGrantMoemoepointSchema } from '~/validations/admin'
import { createMessage } from '~/app/api/utils/message'
import {
  earnMoemoepoint,
  normalizeMoemoepointReason
} from '~/app/api/moemoepoint/service'
import { MOEMOEPOINT_REASON } from '~/constants/moemoepoint'

const REQUEST_ID_REUSED_ERROR =
  '该请求标识已用于另一笔发放, 请关闭弹窗并核对账单后重新发起'

/**
 * 两个管理员客户端同时重试同一个 requestId 时, 两条事务都会读不到台账而各自
 * 插入, 输掉的一方拿到 idempotency_key 的 P2002。整个事务重跑一次, 第二次
 * 就能读到已提交的台账并走重放分支。
 */
const isIdempotencyKeyConflict = (error: unknown) => {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false
  }
  const target = Array.isArray(error.meta?.target)
    ? (error.meta.target as string[]).join(',')
    : String(error.meta?.target ?? '')
  return target.includes('idempotency_key')
}

export const grantMoemoepoint = async (
  input: z.infer<typeof adminGrantMoemoepointSchema>,
  adminUid: number
) => {
  const { uid, amount, reason, requestId } = input

  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { id: true, name: true }
  })
  if (!user) {
    return '未找到该用户'
  }

  const admin = await prisma.user.findUnique({
    where: { id: adminUid },
    select: { id: true, name: true }
  })
  if (!admin) {
    return '未找到该管理员'
  }

  const ledgerReason = reason || MOEMOEPOINT_REASON.adminGrant.text
  const idempotencyKey = `admin-grant:${adminUid}:${requestId}`

  const runGrant = () =>
    prisma.$transaction(async (tx) => {
      const change = await earnMoemoepoint(tx, {
        userId: uid,
        amount,
        reasonCode: MOEMOEPOINT_REASON.adminGrant.code,
        reason: ledgerReason,
        referenceType: 'admin_grant',
        referenceId: adminUid,
        link: '/moemoepoint',
        operatorId: adminUid,
        idempotencyKey
      })

      if (!change.applied) {
        // 幂等键只保证「这个 requestId 发过钱」, 不保证发的是这一笔。换了金额或
        // 收款人再用同一个 requestId 重试, 必须报错而不是假装成功。
        const ledger = await tx.user_moemoepoint_ledger.findUnique({
          where: { id: change.ledgerId },
          select: {
            user_id: true,
            balance_delta: true,
            reason_code: true,
            reason: true,
            operator_id: true,
            reference_type: true
          }
        })
        const sameRequest =
          ledger &&
          ledger.user_id === uid &&
          ledger.balance_delta === amount &&
          ledger.reason_code === MOEMOEPOINT_REASON.adminGrant.code &&
          ledger.reason === normalizeMoemoepointReason(ledgerReason) &&
          ledger.operator_id === adminUid &&
          ledger.reference_type === 'admin_grant'
        if (!sameRequest) {
          return REQUEST_ID_REUSED_ERROR
        }
        return { balance: change.balance, applied: false }
      }

      const reasonText = reason ? `\n理由: ${reason}` : ''
      await createMessage(
        {
          type: 'system',
          content: `管理员为您发放了 ${amount} 萌萌点。${reasonText}`,
          sender_id: adminUid,
          recipient_id: uid,
          link: '/moemoepoint'
        },
        tx
      )

      await tx.admin_log.create({
        data: {
          type: 'grant',
          user_id: adminUid,
          content: `管理员 ${admin.name} 为用户 ${user.name} (ID: ${uid}) 发放了 ${amount} 萌萌点\n\n原总萌萌点: ${change.balance.total - amount}\n发放后总萌萌点: ${change.balance.total}${reasonText}`
        }
      })

      return { balance: change.balance, applied: true }
    })

  try {
    return await runGrant()
  } catch (error) {
    if (!isIdempotencyKeyConflict(error)) {
      throw error
    }
    return await runGrant()
  }
}
