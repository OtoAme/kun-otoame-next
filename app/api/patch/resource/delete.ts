import { z } from 'zod'
import { prisma } from '~/prisma/index'
import {
  deletePatchResourceCache,
  deletePatchResourceLink,
  updatePatchAttributes
} from './_helper'

const resourceIdSchema = z.object({
  resourceId: z.coerce
    .number({ message: '资源 ID 必须为数字' })
    .min(1)
    .max(9999999)
})

export const deleteResource = async (
  input: z.infer<typeof resourceIdSchema>,
  uid: number,
  userRole: number
) => {
  const patchResource = await prisma.patch_resource.findUnique({
    where: { id: input.resourceId },
    include: {
      links: true
    }
  })
  if (!patchResource) {
    return '未找到对应的资源'
  }

  const resourceUserUid = patchResource.user_id
  if (patchResource.user_id !== uid && userRole < 3) {
    return '您没有权限删除该资源'
  }

  const s3Contents = Array.from(
    new Set(
      patchResource.links
        .filter((link) => link.storage === 's3')
        .map((link) => link.content)
    )
  )

  const uniqueId = await prisma.$transaction(async (prisma) => {
    await prisma.user.update({
      where: { id: resourceUserUid },
      data: { moemoepoint: { increment: -3 } }
    })

    await prisma.patch_resource.delete({
      where: { id: input.resourceId }
    })

    return await updatePatchAttributes(patchResource.patch_id, prisma)
  })

  await deletePatchResourceCache(uniqueId)

  for (const content of s3Contents) {
    try {
      await deletePatchResourceLink(content)
    } catch (error) {
      console.error('[Upload] Failed to delete S3 object after resource delete', {
        content,
        resourceId: input.resourceId,
        error
      })
    }
  }

  return {}
}
