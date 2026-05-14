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
  const patchResource = await prisma.patch_resource.findUnique({
    where: { id: input.resourceId },
    include: {
      patch: {
        select: {
          name: true,
          unique_id: true
        }
      },
      links: {
        orderBy: { sort_order: 'asc' }
      }
    }
  })
  if (!patchResource) {
    return '未找到对应的资源'
  }

  const s3Contents = Array.from(
    new Set(
      patchResource.links
        .filter((link) => link.storage === 's3')
        .map((link) => link.content)
    )
  )

  const uniqueId = await prisma.$transaction(async (prisma) => {
    await prisma.patch_resource.delete({
      where: { id: input.resourceId }
    })

    const uniqueId = await updatePatchAttributes(patchResource.patch_id, prisma)

    const sanitizedResource = sanitizeResourceForAuditLog(patchResource)
    await prisma.admin_log.create({
      data: {
        type: 'delete',
        user_id: uid,
        content: `管理员 ${admin.name} 删除了一个补丁资源\n\nOtomeGame 名:\n${patchResource.patch.name}\n\n补丁资源信息:\n${JSON.stringify(sanitizedResource)}`
      }
    })

    return uniqueId
  })

  await deletePatchResourceCache(uniqueId)

  for (const content of s3Contents) {
    try {
      await deletePatchResourceLink(content)
    } catch (error) {
      console.error('[Upload] Failed to delete S3 object after admin delete', {
        content,
        resourceId: input.resourceId,
        error
      })
    }
  }

  return {}
}
