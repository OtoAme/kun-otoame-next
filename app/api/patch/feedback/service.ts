import { z } from 'zod'
import { createPatchFeedbackSchema } from '~/validations/patch'
import { createMessage } from '~/app/api/utils/message'
import { prisma } from '~/prisma'

export const createFeedback = async (
  input: z.infer<typeof createPatchFeedbackSchema>,
  uid: number
) => {
  const patch = await prisma.patch.findUnique({
    where: { id: input.patchId }
  })
  const user = await prisma.user.findUnique({
    where: { id: uid }
  })

  const STATIC_CONTENT = `用户: ${user?.name} 对 游戏: ${patch?.name} 提交了一个反馈\n\n反馈内容\n\n${input.content}`

  await createMessage({
    type: 'feedback',
    content: STATIC_CONTENT,
    sender_id: uid,
    link: patch?.unique_id ? `/${patch.unique_id}` : ''
  })

  return {}
}
