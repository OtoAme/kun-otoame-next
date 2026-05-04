import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { createDedupMessage } from '~/app/api/utils/message'

export const commentIdSchema = z.object({
  commentId: z.coerce
    .number({ message: '评论 ID 必须为数字' })
    .min(1)
    .max(9999999)
})

export const toggleCommentLike = async (
  input: z.infer<typeof commentIdSchema>,
  uid: number
) => {
  const { commentId } = input

  const comment = await prisma.patch_comment.findUnique({
    where: { id: commentId },
    include: { patch: { select: { unique_id: true } } }
  })
  if (!comment) {
    return '未找到评论'
  }
  if (comment.user_id === uid) {
    return '您不能给自己点赞'
  }

  const existingLike = await prisma.user_patch_comment_like_relation.findUnique(
    {
      where: {
        user_id_comment_id: {
          user_id: uid,
          comment_id: commentId
        }
      }
    }
  )

  return await prisma.$transaction(async (prisma) => {
    if (existingLike) {
      await prisma.user_patch_comment_like_relation.delete({
        where: {
          user_id_comment_id: {
            user_id: uid,
            comment_id: commentId
          }
        }
      })
    } else {
      await prisma.user_patch_comment_like_relation.create({
        data: {
          user_id: uid,
          comment_id: commentId
        }
      })
    }

    await createDedupMessage({
      type: 'like',
      content: `点赞了您的评论! -> ${comment.content.slice(0, 107)}`,
      sender_id: uid,
      recipient_id: comment.user_id,
      link: `/${comment.patch.unique_id}`
    })

    await prisma.user.update({
      where: { id: comment.user_id },
      data: { moemoepoint: { increment: existingLike ? -1 : 1 } }
    })

    return !existingLike
  })
}
