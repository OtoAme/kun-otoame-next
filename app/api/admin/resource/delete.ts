import { closeLinkCases } from '~/app/api/case/linkHealth'
import {
  lockResourceForMutation,
  resourcePostCommit,
  ResourceMutationError,
  runResourceMutation
} from '~/app/api/patch/resource/mutation'
import { z } from 'zod'
import { prisma } from '~/prisma/index'
import {
  deletePatchResourceLink,
  deletePatchResourceCache,
  sanitizeResourceForAuditLog,
  updatePatchAttributes
} from '~/app/api/patch/resource/_helper'

const resourceIdSchema = z.object({
  resourceId: z.coerce
    .number({ message: '资源 ID 必须为数字' })
    .min(1)
    .max(9999999)
})

export const deleteResource = async (
  input: z.infer<typeof resourceIdSchema>,
  uid: number
) => {
  const admin = await prisma.user.findUnique({ where: { id: uid } })
  if (!admin) {
    return '未找到该管理员'
  }
  try {
    const result = await runResourceMutation(async (tx) => {
      const patchResource = await lockResourceForMutation(tx, input.resourceId)
      if (!patchResource)
        throw new ResourceMutationError('未找到对应的资源', 404)
      await closeLinkCases(tx, {
        resourceIds: [patchResource.id],
        resolution: 'link_removed',
        actorType: 'staff',
        actorId: uid,
        now: new Date()
      })
      await tx.patch_resource.delete({ where: { id: patchResource.id } })
      const uniqueId = await updatePatchAttributes(patchResource.patch_id, tx)
      const safeResource = sanitizeResourceForAuditLog({
        id: patchResource.id,
        name: patchResource.name,
        section: patchResource.section,
        type: patchResource.type,
        language: patchResource.language,
        platform: patchResource.platform,
        note: patchResource.note,
        links: patchResource.links.map((link) => ({
          id: link.id,
          storage: link.storage,
          size: link.size,
          content: link.content,
          code: link.code,
          password: link.password,
          hash: link.hash
        }))
      })
      const resourceTypeName =
        patchResource.section === 'galgame' ? '游戏资源' : '补丁资源'
      await tx.admin_log.create({
        data: {
          type: 'delete',
          user_id: uid,
          content: `管理员 ${admin.name} 删除了一个${resourceTypeName}\n\nOtomeGame 名:\n${patchResource.patch.name}\n\n${resourceTypeName}信息:\n${JSON.stringify(safeResource)}`
        }
      })
      return {
        uniqueId,
        s3Contents: [
          ...new Set(
            patchResource.links
              .filter((link) => link.storage === 's3')
              .map((link) => link.content)
          )
        ]
      }
    })
    await resourcePostCommit('admin-resource-delete-cache', () =>
      deletePatchResourceCache(result.uniqueId)
    )
    for (const content of result.s3Contents)
      await resourcePostCommit('admin-resource-delete-object', () =>
        deletePatchResourceLink(content)
      )
    return {}
  } catch (error) {
    if (error instanceof ResourceMutationError) return error.message
    throw error
  }
}
