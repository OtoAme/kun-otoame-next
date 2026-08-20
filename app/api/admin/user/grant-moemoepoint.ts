import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { adminGrantMoemoepointSchema } from '~/validations/admin'
import { createMessage } from '~/app/api/utils/message'
import { earnMoemoepoint } from '~/app/api/moemoepoint/service'
import { MOEMOEPOINT_REASON } from '~/constants/moemoepoint'

export const grantMoemoepoint = async (
  input: z.infer<typeof adminGrantMoemoepointSchema>,
  adminUid: number
) => {
  const { uid, amount, reason } = input

  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { id: true, name: true, moemoepoint: true }
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

  return prisma.$transaction(async (tx) => {
    const change = await earnMoemoepoint(tx, {
      userId: uid,
      amount,
      reasonCode: MOEMOEPOINT_REASON.adminGrant.code,
      reason: reason || MOEMOEPOINT_REASON.adminGrant.text,
      referenceType: 'admin_grant',
      referenceId: adminUid,
      link: '/moemoepoint',
      operatorId: adminUid
    })

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
        content: `管理员 ${admin.name} 为用户 ${user.name} (ID: ${uid}) 发放了 ${amount} 萌萌点\n\n原萌萌点: ${user.moemoepoint}\n发放后萌萌点: ${change.balance.total}${reason ? `\n理由: ${reason}` : ''}`
      }
    })

    return { balance: change.balance }
  })
}
