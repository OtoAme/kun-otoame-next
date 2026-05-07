import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { updatePatchResource as updatePatchResourceByRole } from '~/app/api/patch/resource/update'
import { sanitizeResourceForAuditLog } from '~/app/api/patch/resource/_helper'
import { patchResourceUpdateSchema } from '~/validations/patch'

export const updatePatchResource = async (
  input: z.infer<typeof patchResourceUpdateSchema>,
  uid: number
) => {
  const admin = await prisma.user.findUnique({ where: { id: uid } })
  if (!admin) {
    return '未找到该管理员'
  }

  const { resourceId } = input
  const resource = await prisma.patch_resource.findUnique({
    where: { id: resourceId },
    include: {
      links: {
        orderBy: { sort_order: 'asc' }
      }
    }
  })
  if (!resource) {
    return '未找到该资源'
  }

  const updatedResource = await updatePatchResourceByRole(input, uid, 3)
  if (typeof updatedResource === 'string') {
    return updatedResource
  }

  const sanitizedResource = sanitizeResourceForAuditLog(resource)
  const sanitizedUpdatedResource = sanitizeResourceForAuditLog(updatedResource)

  return await prisma.$transaction(async (prisma) => {
    await prisma.admin_log.create({
      data: {
        type: 'update',
        user_id: uid,
        content: `管理员 ${admin.name} 更新了一个补丁资源信息\n\n原补丁资源信息:\n${JSON.stringify(sanitizedResource)}\n\n新补丁资源信息:\n${JSON.stringify(sanitizedUpdatedResource)}`
      }
    })

    return updatedResource
  })
}
