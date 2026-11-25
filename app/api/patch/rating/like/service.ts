import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { createDedupMessage } from '~/app/api/utils/message'
import { rewardLikeOnce } from '~/app/api/patch/like/reward'
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

  if (existingLike) {
    await prisma.patch_rating_like.deleteMany({
      where: { user_id: uid, patch_rating_id: ratingId }
    })
    return false
  }

  return await prisma.$transaction(async (tx) => {
    const { count } = await tx.patch_rating_like.createMany({
      data: { user_id: uid, patch_rating_id: ratingId },
      skipDuplicates: true
    })
    if (!count) return true

    await createDedupMessage(
      {
        event_type: 'like',
        type: 'like',
        content: `有人点赞了您的 OtomeGame 评价 -> ${rating.short_summary.slice(0, 107)}`,
        sender_id: uid,
        recipient_id: rating.user_id,
        link: `/${rating.patch.unique_id}`
      },
      tx
    )

    const reason = MOEMOEPOINT_REASON.ratingLiked
    await rewardLikeOnce(tx, uid, {
      userId: rating.user_id,
      reasonCode: reason.code,
      reason: `${reason.text}：${rating.short_summary.slice(0, 100)}`,
      referenceType: 'patch_rating',
      referenceId: rating.id,
      link: `/${rating.patch.unique_id}`
    })
    return true
  })
}
