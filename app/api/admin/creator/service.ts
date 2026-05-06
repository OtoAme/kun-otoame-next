import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { createMessage } from '~/app/api/utils/message'
import { updateKunSessions } from '~/app/api/utils/jwt'
import {
  adminPaginationSchema,
  approveCreatorSchema,
  declineCreatorSchema
} from '~/validations/admin'
import type { AdminCreator } from '~/types/api/admin'

export const getAdminCreator = async (
  input: z.infer<typeof adminPaginationSchema>
) => {
  const { page, limit } = input
  const offset = (page - 1) * limit

  const [data, total] = await Promise.all([
    prisma.user_message.findMany({
      where: {
        type: 'apply',
        sender_id: { not: null },
        recipient_id: null
      },
      take: limit,
      skip: offset,
      orderBy: { created: 'desc' },
      include: {
        sender: {
          include: {
            _count: {
              select: {
                patch_resource: true
              }
            }
          }
        }
      }
    }),
    prisma.user_message.count({
      where: {
        type: 'apply',
        sender_id: { not: null },
        recipient_id: null
      }
    })
  ])

  const creators: AdminCreator[] = data.map((creator) => ({
    id: creator.id,
    content: creator.content,
    status: creator.status,
    sender: {
      id: creator.sender!.id,
      name: creator.sender!.name,
      avatar: creator.sender!.avatar
    },
    patchResourceCount: creator.sender?._count.patch_resource ?? 0,
    created: creator.created
  }))

  return { creators, total }
}

export const approveCreator = async (
  input: z.infer<typeof approveCreatorSchema>,
  adminUid: number
) => {
  const { messageId, uid } = input
  const message = await prisma.user_message.findUnique({
    where: { id: messageId }
  })
  if (!message) {
    return '未找到该创作者请求'
  }
  if (message.sender_id !== uid) {
    return '创作者请求与用户不匹配'
  }

  const creator = await prisma.user.findUnique({
    where: { id: uid },
    include: {
      _count: {
        select: {
          patch_resource: true
        }
      }
    }
  })
  if (!creator) {
    return '未找到该创作者'
  }
  const admin = await prisma.user.findUnique({ where: { id: adminUid } })
  if (!admin) {
    return '未找到该管理员'
  }

  const response = await prisma.$transaction(async (prisma) => {
    await prisma.user_message.update({
      where: { id: messageId },
      // status: 0 - unread, 1 - read, 2 - approve, 3 - decline
      data: { status: { set: 2 } }
    })

    await prisma.user.update({
      where: { id: uid },
      data: { role: { set: 2 } }
    })

    await createMessage({
      type: 'apply',
      content: '恭喜! 您的创作者申请已经通过!',
      recipient_id: message.sender_id ?? undefined,
      link: '/apply/success'
    })

    await prisma.admin_log.create({
      data: {
        type: 'approve',
        user_id: adminUid,
        content: `管理员 ${admin.name} 同意了一位创作者申请\n\n创作者信息:\n用户名:${creator.name}\n已发布资源数:${creator._count.patch_resource}`
      }
    })

    return {}
  })

  await updateKunSessions(uid, { role: 2 })

  return response
}

export const declineCreator = async (
  input: z.infer<typeof declineCreatorSchema>,
  adminUid: number
) => {
  const { messageId, reason } = input
  const message = await prisma.user_message.findUnique({
    where: { id: messageId }
  })
  if (!message) {
    return '未找到该创作者请求'
  }
  const creator = await prisma.user.findUnique({
    where: { id: message.sender_id ?? 0 },
    include: {
      _count: {
        select: {
          patch_resource: true
        }
      }
    }
  })
  if (!creator) {
    return '未找到该创作者'
  }
  const admin = await prisma.user.findUnique({ where: { id: adminUid } })
  if (!admin) {
    return '未找到该管理员'
  }

  return prisma.$transaction(async (prisma) => {
    await prisma.user_message.update({
      where: { id: messageId },
      // status: 0 - unread, 1 - read, 2 - approve, 3 - decline
      data: { status: { set: 3 } }
    })

    await createMessage({
      type: 'apply',
      content: `您的创作者申请被拒绝, 理由: ${reason}`,
      recipient_id: message.sender_id ?? undefined,
      link: '/'
    })

    await prisma.admin_log.create({
      data: {
        type: 'decline',
        user_id: adminUid,
        content: `管理员 ${admin.name} 拒绝了一位创作者申请\n\n拒绝原因:${reason}\n创作者信息:\n用户名:${creator.name}\n已发布资源数:${creator._count.patch_resource}`
      }
    })

    return {}
  })
}
