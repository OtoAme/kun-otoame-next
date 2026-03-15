import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { adminGrantMoemoepointSchema } from '~/validations/admin'
import { createMessage } from '~/app/api/utils/message'

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

  return prisma.$transaction(async (prisma) => {
    await prisma.user.update({
      where: { id: uid },
      data: { moemoepoint: { increment: amount } }
    })

    const reasonText = reason ? `\n理由: ${reason}` : ''
    await createMessage({
      type: 'system',
      content: `管理员为您发放了 ${amount} 萌萌点。${reasonText}`,
      sender_id: adminUid,
      recipient_id: uid,
      link: `/user/${uid}/resource`
    })

    await prisma.admin_log.create({
      data: {
        type: 'grant',
        user_id: adminUid,
        content: `管理员 ${admin.name} 为用户 ${user.name} (ID: ${uid}) 发放了 ${amount} 萌萌点\n\n原萌萌点: ${user.moemoepoint}\n发放后萌萌点: ${user.moemoepoint + amount}${reason ? `\n理由: ${reason}` : ''}`
      }
    })

    return {}
  })
}
