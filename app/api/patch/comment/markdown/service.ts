import { z } from 'zod'
import { prisma } from '~/prisma/index'

export const commentIdSchema = z.object({
  commentId: z.coerce
    .number({ message: '评论 ID 必须为数字' })
    .min(1)
    .max(9999999)
})

export const getCommentMarkdown = async (
  input: z.infer<typeof commentIdSchema>
) => {
  const { commentId } = input

  const comment = await prisma.patch_comment.findUnique({
    where: { id: commentId },
    select: {
      content: true
    }
  })

  return { content: comment?.content ?? '' }
}
