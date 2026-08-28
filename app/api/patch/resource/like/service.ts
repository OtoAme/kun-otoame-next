import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { createDedupMessage } from '~/app/api/utils/message'
import {
  earnMoemoepoint,
  reverseMoemoepoint
} from '~/app/api/moemoepoint/service'
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

  // count 守卫的原因同 patch/comment/like/service.ts: 同向的并发请求只应产生
  // 一次通知与一次萌萌点变动, 落空的那次直接返回同一个目标状态。
  return await prisma.$transaction(async (prisma) => {
    if (existingLike) {
      const { count } =
        await prisma.user_patch_resource_like_relation.deleteMany({
          where: {
            user_id: uid,
            resource_id: resourceId
          }
        })
      if (!count) {
        return false
      }
    } else {
      const { count } =
        await prisma.user_patch_resource_like_relation.createMany({
          data: {
            user_id: uid,
            resource_id: resourceId
          },
          skipDuplicates: true
        })
      if (!count) {
        return true
      }

      await createDedupMessage(
        {
          type: 'like',
          content: `点赞了您在 ${resource.patch.name} 下发布的补丁资源`,
          sender_id: uid,
          recipient_id: resource.user_id,
          link: `/${resource.patch.unique_id}`
        },
        prisma
      )
    }

    const reason = existingLike
      ? MOEMOEPOINT_REASON.resourceUnliked
      : MOEMOEPOINT_REASON.resourceLiked
    // 不传 idempotencyKey, 原因同 patch/comment/like/service.ts:
    // 自增关系 id 无法在重放间保持稳定, 真正的守卫是
    // user_patch_resource_like_relation 的 [user_id, resource_id] 唯一约束 + patch-like 限流。
    const change = {
      userId: resource.user_id,
      amount: 1,
      reasonCode: reason.code,
      reason: `${reason.text}：${resource.name.slice(0, 100)}`,
      referenceType: 'patch_resource',
      referenceId: resource.id,
      link: `/${resource.patch.unique_id}`
    }
    if (existingLike) {
      await reverseMoemoepoint(prisma, change)
    } else {
      await earnMoemoepoint(prisma, change)
    }

    return !existingLike
  })
}
