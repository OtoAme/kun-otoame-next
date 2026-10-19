import { z } from 'zod'
import { LINK_HEALTH_ERRORS } from '~/constants/linkHealth'
import { closeLinkCases } from '~/app/api/case/linkHealth'
import {
  lockResourceForMutation,
  resourcePostCommit,
  ResourceMutationError,
  runResourceMutation
} from './mutation'
import {
  deletePatchResourceCache,
  deletePatchResourceLink,
  updatePatchAttributes
} from './_helper'
import { reverseMoemoepoint } from '~/app/api/moemoepoint/service'
import { MOEMOEPOINT_REASON } from '~/constants/moemoepoint'

const resourceIdSchema = z.object({
  resourceId: z.coerce
    .number({ message: '资源 ID 必须为数字' })
    .min(1)
    .max(9999999)
})

export const deleteResource = async (
  input: z.infer<typeof resourceIdSchema>,
  uid: number,
  userRole: number,
  options: { expectedOwnerId?: number } = {}
) => {
  try {
    const result = await runResourceMutation(async (tx) => {
      const patchResource = await lockResourceForMutation(tx, input.resourceId)
      if (!patchResource)
        throw new ResourceMutationError('未找到对应的资源', 404)
      if (
        options.expectedOwnerId !== undefined &&
        patchResource.user_id !== options.expectedOwnerId
      )
        throw new ResourceMutationError('您没有权限操作该资源', 403)
      if (patchResource.user_id !== uid && userRole < 3)
        throw new ResourceMutationError('您没有权限删除该资源', 403)
      if (
        userRole < 3 &&
        patchResource.links.some((link) => link.storage === 'touchgal')
      )
        throw new ResourceMutationError(
          LINK_HEALTH_ERRORS.forbidden.message,
          403
        )
      const now = new Date()
      await closeLinkCases(tx, {
        resourceIds: [patchResource.id],
        resolution: 'link_removed',
        actorType: userRole >= 3 ? 'staff' : 'publisher',
        actorId: uid,
        now
      })
      const pointChange = await reverseMoemoepoint(tx, {
        userId: patchResource.user_id,
        amount: 3,
        reasonCode: MOEMOEPOINT_REASON.resourceDeleted.code,
        reason: `${MOEMOEPOINT_REASON.resourceDeleted.text}：${patchResource.name}`,
        referenceType: 'patch_resource',
        referenceId: patchResource.id,
        idempotencyKey: `resource:${patchResource.id}:delete-reversal`
      })
      await tx.patch_resource.delete({ where: { id: patchResource.id } })
      return {
        uniqueId: await updatePatchAttributes(patchResource.patch_id, tx),
        balanceUserId: patchResource.user_id,
        moemoepointBalance: pointChange.balance,
        s3Contents: [
          ...new Set(
            patchResource.links
              .filter((link) => link.storage === 's3')
              .map((link) => link.content)
          )
        ]
      }
    })
    await resourcePostCommit('resource-delete-cache', () =>
      deletePatchResourceCache(result.uniqueId)
    )
    for (const content of result.s3Contents)
      await resourcePostCommit('resource-delete-object', () =>
        deletePatchResourceLink(content)
      )
    return {
      balanceUserId: result.balanceUserId,
      moemoepointBalance: result.moemoepointBalance
    }
  } catch (error) {
    if (error instanceof ResourceMutationError) return error.message
    throw error
  }
}
