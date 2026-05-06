import { z } from 'zod'
import { createPatchFeedbackSchema } from '~/validations/patch'
import { prisma } from '~/prisma'

export const createFeedback = async (
  input: z.infer<typeof createPatchFeedbackSchema>,
  uid: number
) => {
  const [patch, user] = await Promise.all([
    prisma.patch.findUnique({
      where: { id: input.patchId },
      select: {
        id: true,
        name: true,
        unique_id: true
      }
    }),
    prisma.user.findUnique({
      where: { id: uid },
      select: {
        id: true,
        name: true
      }
    })
  ])

  if (!patch) {
    return '未找到对应 OtomeGame'
  }
  if (!user) {
    return '未找到该用户'
  }

  const feedbackContent = `用户: ${user.name} 对 游戏: ${patch.name} 提交了一个反馈\n\n反馈内容\n\n${input.content}`
  const noticeContent = `用户 ${user.name} 对游戏「${patch.name}」提交了反馈，请前往处理。`
  const patchLink = `/${patch.unique_id}`

  await prisma.$transaction(async (prisma) => {
    await prisma.user_message.create({
      data: {
        type: 'feedback',
        content: feedbackContent,
        sender_id: uid,
        link: patchLink
      }
    })

    const admins = await prisma.user.findMany({
      where: { role: { gte: 3 } },
      select: { id: true }
    })
    if (admins.length) {
      await prisma.user_message.createMany({
        data: admins.map((admin) => ({
          type: 'feedback',
          content: noticeContent,
          sender_id: uid,
          recipient_id: admin.id,
          link: '/admin/feedback'
        }))
      })
    }
  })

  return {}
}
