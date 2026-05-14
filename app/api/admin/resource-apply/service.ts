import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { createMessage } from '~/app/api/utils/message'
import {
  approvePatchResourceSchema,
  declinePatchResourceSchema
} from '~/validations/admin'
import {
  deletePatchResourceLink,
  deletePatchResourceCache,
  updatePatchAttributes
} from '~/app/api/patch/resource/_helper'

export const approvePatchResource = async (
  input: z.infer<typeof approvePatchResourceSchema>,
  adminUid: number
) => {
  const { resourceId } = input

  const resource = await prisma.patch_resource.findUnique({
    where: { id: resourceId },
    include: {
      user: {
        select: {
          name: true
        }
      },
      patch: {
        select: {
          unique_id: true,
          name: true
        }
      },
      links: {
        orderBy: { sort_order: 'asc' }
      }
    }
  })
  if (!resource) {
    return '该资源不存在'
  }
  if (resource.status !== 2) {
    return '当前资源状态无需审核'
  }

  const admin = await prisma.user.findUnique({ where: { id: adminUid } })
  if (!admin) {
    return '管理员不存在'
  }

  const result = await prisma.$transaction(async (prisma) => {
    await prisma.patch_resource.update({
      where: { id: resourceId },
      data: { status: { set: 0 } }
    })

    const uniqueId = await updatePatchAttributes(resource.patch_id, prisma)

    const resourceTypeName =
      resource.section === 'galgame' ? '游戏资源' : '补丁资源'

    await createMessage(
      {
        type: 'system',
        content: `你上传的${resourceTypeName}「${resource.name || resource.patch.name}」已通过审核，感谢你的分享！`,
        recipient_id: resource.user_id,
        link: `/${resource.patch.unique_id}`
      },
      prisma
    )

    await prisma.admin_log.create({
      data: {
        type: 'approve',
        user_id: adminUid,
        content: `管理员 ${admin.name} 审核通过了一条${resourceTypeName}\n\nGalgame 名称:${resource.patch.name}\n资源 ID:${resource.id}\n资源标题:${resource.name}\n上传用户:${resource.user.name}`
      }
    })

    return { uniqueId }
  })

  await deletePatchResourceCache(result.uniqueId)

  return {}
}

export const declinePatchResource = async (
  input: z.infer<typeof declinePatchResourceSchema>,
  adminUid: number
) => {
  const { resourceId, reason } = input

  const resource = await prisma.patch_resource.findUnique({
    where: { id: resourceId },
    include: {
      user: {
        select: {
          name: true
        }
      },
      patch: {
        select: {
          unique_id: true,
          name: true
        }
      },
      links: {
        orderBy: { sort_order: 'asc' }
      }
    }
  })
  if (!resource) {
    return '该资源不存在'
  }

  const admin = await prisma.user.findUnique({ where: { id: adminUid } })
  if (!admin) {
    return '管理员不存在'
  }

  const s3Contents = Array.from(
    new Set(
      resource.links
        .filter((link) => link.storage === 's3')
        .map((link) => link.content)
    )
  )

  const result = await prisma.$transaction(async (prisma) => {
    await prisma.patch_resource.delete({
      where: { id: resourceId }
    })

    const uniqueId = await updatePatchAttributes(resource.patch_id, prisma)

    const resourceTypeName =
      resource.section === 'galgame' ? '游戏资源' : '补丁资源'

    await createMessage(
      {
        type: 'system',
        content: `你上传的${resourceTypeName}「${resource.name || resource.patch.name}」未通过审核，原因：${reason}`,
        recipient_id: resource.user_id,
        link: '/'
      },
      prisma
    )

    await prisma.admin_log.create({
      data: {
        type: 'decline',
        user_id: adminUid,
        content: `管理员 ${admin.name} 拒绝了一条${resourceTypeName}\n\n拒绝原因:${reason}\nGalgame 名称:${resource.patch.name}\n资源 ID:${resource.id}\n资源标题:${resource.name}\n上传用户:${resource.user.name}`
      }
    })

    return { uniqueId }
  })

  await deletePatchResourceCache(result.uniqueId)

  for (const content of s3Contents) {
    try {
      await deletePatchResourceLink(content)
    } catch (error) {
      console.error('[Upload] Failed to delete S3 object after decline', {
        content,
        resourceId,
        error
      })
    }
  }

  return {}
}
