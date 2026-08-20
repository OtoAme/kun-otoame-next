import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { createDedupMessage } from '~/app/api/utils/message'
import {
  earnMoemoepoint,
  reverseMoemoepoint
} from '~/app/api/moemoepoint/service'
import { MOEMOEPOINT_REASON } from '~/constants/moemoepoint'

export const ratingIdSchema = z.object({
  ratingId: z.coerce.number({ message: 'ID 不正确' }).min(1).max(9999999)
})

export const toggleRatingLike = async (
  input: z.infer<typeof ratingIdSchema>,
  uid: number
) => {
  const { ratingId } = input

  const rating = await prisma.patch_rating.findUnique({
    where: { id: ratingId },
    include: { patch: { select: { unique_id: true, name: true } } }
  })
  if (!rating) {
    return '评价不存在'
  }
  if (rating.user_id === uid) {
    return '您不能给自己点赞'
  }

  const existingLike = await prisma.patch_rating_like.findUnique({
    where: {
      patch_rating_id_user_id: {
        patch_rating_id: ratingId,
        user_id: uid
      }
    }
  })

  return await prisma.$transaction(async (prisma) => {
    if (existingLike) {
      await prisma.patch_rating_like.delete({
        where: {
          patch_rating_id_user_id: {
            patch_rating_id: ratingId,
            user_id: uid
          }
        }
      })
    } else {
      await prisma.patch_rating_like.create({
        data: {
          patch_rating_id: ratingId,
          user_id: uid
        }
      })

      await createDedupMessage(
        {
          type: 'like',
          content: `有人点赞了您的 OtomeGame 评价 -> ${rating.short_summary.slice(0, 107)}`,
          sender_id: uid,
          recipient_id: rating.user_id,
          link: `/${rating.patch.unique_id}`
        },
        prisma
      )
    }

    const reason = existingLike
      ? MOEMOEPOINT_REASON.ratingUnliked
      : MOEMOEPOINT_REASON.ratingLiked
    // 不传 idempotencyKey, 原因同 patch/comment/like/service.ts:
    // 自增关系 id 无法在重放间保持稳定, 真正的守卫是
    // patch_rating_like 的 [patch_rating_id, user_id] 唯一约束 + patch-like 限流。
    const change = {
      userId: rating.user_id,
      amount: 1,
      reasonCode: reason.code,
      reason: `${reason.text}：${rating.short_summary.slice(0, 100)}`,
      referenceType: 'patch_rating',
      referenceId: rating.id,
      link: `/${rating.patch.unique_id}`
    }
    if (existingLike) {
      await reverseMoemoepoint(prisma, change)
    } else {
      await earnMoemoepoint(prisma, change)
    }

    return !existingLike
  })
}
