import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { createDedupMessage } from '~/app/api/utils/message'
import {
  earnMoemoepoint,
  reverseMoemoepoint
} from '~/app/api/moemoepoint/service'
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

  // existingLike 是事务外读的, 两个同向的并发请求会读到同一个方向。count 为 0
  // 说明另一个请求已经完成了同一次迁移: 关系行的最终状态就是本次请求的目标,
  // 但通知与萌萌点只应记一次, 所以这里跳过全部副作用直接返回目标状态。
  return await prisma.$transaction(async (prisma) => {
    if (existingLike) {
      const { count } =
        await prisma.user_patch_comment_like_relation.deleteMany({
          where: {
            user_id: uid,
            comment_id: commentId
          }
        })
      if (!count) {
        return false
      }
    } else {
      const { count } =
        await prisma.user_patch_comment_like_relation.createMany({
          data: {
            user_id: uid,
            comment_id: commentId
          },
          skipDuplicates: true
        })
      if (!count) {
        return true
      }

      await createDedupMessage(
        {
          type: 'like',
          content: `点赞了您的评论! -> ${comment.content.slice(0, 107)}`,
          sender_id: uid,
          recipient_id: comment.user_id,
          link: `/${comment.patch.unique_id}`
        },
        prisma
      )
    }

    const reason = existingLike
      ? MOEMOEPOINT_REASON.commentUnliked
      : MOEMOEPOINT_REASON.commentLiked
    // 这里不传 idempotencyKey: 点赞关系是自增主键, 每次点赞都是新 id,
    // 取消点赞用的又是即将被删除的行 id, 幂等键无法在重放间保持稳定。
    // 真正防止重复点赞的是 user_patch_comment_like_relation 的
    // [user_id, comment_id] 唯一约束, 加上路由层的 patch-like 限流。
    const change = {
      userId: comment.user_id,
      amount: 1,
      reasonCode: reason.code,
      reason: `${reason.text}：${comment.content.slice(0, 100)}`,
      referenceType: 'patch_comment',
      referenceId: comment.id,
      link: `/${comment.patch.unique_id}`
    }
    if (existingLike) {
      await reverseMoemoepoint(prisma, change)
    } else {
      await earnMoemoepoint(prisma, change)
    }

    return !existingLike
  })
}
