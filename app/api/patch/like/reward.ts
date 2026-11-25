import type { Prisma } from '@prisma/client'
import { earnMoemoepoint } from '~/app/api/moemoepoint/service'

type LikeReward = {
  userId: number
  referenceType: 'patch_comment' | 'patch_rating' | 'patch_resource'
  referenceId: number
  reasonCode: string
  reason: string
  link: string
}

export const rewardLikeOnce = async (
  tx: Prisma.TransactionClient,
  likerId: number,
  reward: LikeReward
) => {
  // Separate from the current like so that unliking never resets eligibility.
  const { count } = await tx.patch_like_reward.createMany({
    data: {
      user_id: likerId,
      target_type: reward.referenceType,
      target_id: reward.referenceId
    },
    skipDuplicates: true
  })
  if (count) await earnMoemoepoint(tx, { ...reward, amount: 1 })
}
