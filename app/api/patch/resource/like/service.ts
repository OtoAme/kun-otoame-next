import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { createDedupMessage } from '~/app/api/utils/message'
import { rewardLikeOnce } from '~/app/api/patch/like/reward'
import { MOEMOEPOINT_REASON } from '~/constants/moemoepoint'

export const resourceIdSchema = z.object({
  resourceId: z.coerce
    .number({ message: '资源 ID 必须为数字' })
    .min(1)
    .max(9999999)
})

export const toggleResourceLike = async (
  input: z.infer<typeof resourceIdSchema>,
  uid: number
) => {
  const { resourceId } = input

  const resource = await prisma.patch_resource.findUnique({
    where: { id: resourceId },
    include: {
      patch: {
        select: {
          unique_id: true,
          name: true
        }
      }
    }
  })
  if (!resource) {
    return '未找到资源'
  }
  if (resource.user_id === uid) {
    return '您不能给自己点赞'
  }

  const existingLike =
    await prisma.user_patch_resource_like_relation.findUnique({
      where: {
        user_id_resource_id: {
          user_id: uid,
          resource_id: resourceId
        }
      }
    })

  if (existingLike) {
    await prisma.user_patch_resource_like_relation.deleteMany({
      where: { user_id: uid, resource_id: resourceId }
    })
    return false
  }

  return await prisma.$transaction(async (tx) => {
    const { count } = await tx.user_patch_resource_like_relation.createMany({
      data: { user_id: uid, resource_id: resourceId },
      skipDuplicates: true
    })
    if (!count) return true

    await createDedupMessage(
      {
        event_type: 'like',
        type: 'like',
        content: `点赞了您在 ${resource.patch.name} 下发布的补丁资源`,
        sender_id: uid,
        recipient_id: resource.user_id,
        link: `/${resource.patch.unique_id}`
      },
      tx
    )

    const reason = MOEMOEPOINT_REASON.resourceLiked
    await rewardLikeOnce(tx, uid, {
      userId: resource.user_id,
      reasonCode: reason.code,
      reason: `${reason.text}：${resource.name.slice(0, 100)}`,
      referenceType: 'patch_resource',
      referenceId: resource.id,
      link: `/${resource.patch.unique_id}`
    })
    return true
  })
}
