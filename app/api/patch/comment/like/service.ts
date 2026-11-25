import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { createDedupMessage } from '~/app/api/utils/message'
import { rewardLikeOnce } from '~/app/api/patch/like/reward'
import { MOEMOEPOINT_REASON } from '~/constants/moemoepoint'

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

  if (existingLike) {
    await prisma.user_patch_comment_like_relation.deleteMany({
      where: { user_id: uid, comment_id: commentId }
    })
    return false
  }

  return await prisma.$transaction(async (tx) => {
    const { count } = await tx.user_patch_comment_like_relation.createMany({
      data: { user_id: uid, comment_id: commentId },
      skipDuplicates: true
    })
    if (!count) return true

    await createDedupMessage(
      {
        event_type: 'like',
        type: 'like',
        content: `点赞了您的评论! -> ${comment.content.slice(0, 107)}`,
        sender_id: uid,
        recipient_id: comment.user_id,
        link: `/${comment.patch.unique_id}`
      },
      tx
    )

    const reason = MOEMOEPOINT_REASON.commentLiked
    await rewardLikeOnce(tx, uid, {
      userId: comment.user_id,
      reasonCode: reason.code,
      reason: `${reason.text}：${comment.content.slice(0, 100)}`,
      referenceType: 'patch_comment',
      referenceId: comment.id,
      link: `/${comment.patch.unique_id}`
    })
    return true
  })
}
