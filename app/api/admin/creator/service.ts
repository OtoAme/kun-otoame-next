import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import { createMessage } from '~/app/api/utils/message'
import { updateKunSessions } from '~/app/api/utils/jwt'
import {
  adminCreatorPaginationSchema,
  approveCreatorSchema,
  declineCreatorSchema
} from '~/validations/admin'
import type { AdminCreator } from '~/types/api/admin'

const CREATOR_STATUS_WHERE: Record<
  z.infer<typeof adminCreatorPaginationSchema>['status'],
  Prisma.IntFilter | undefined
> = {
  pending: { in: [0, 1] },
  approved: { equals: 2 },
  declined: { equals: 3 },
  all: undefined
}

export const getAdminCreator = async (
  input: z.infer<typeof adminCreatorPaginationSchema>
) => {
  const { page, limit } = input
  const offset = (page - 1) * limit
  const where: Prisma.user_messageWhereInput = {
    type: 'apply',
    sender_id: { not: null },
    recipient_id: null,
    ...(CREATOR_STATUS_WHERE[input.status]
      ? { status: CREATOR_STATUS_WHERE[input.status] }
      : {})
  }

  const [data, total] = await Promise.all([
    prisma.user_message.findMany({
      where,
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
    prisma.user_message.count({ where })
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

// status: 0 - unread, 1 - read, 2 - approve, 3 - decline
const OPEN_APPLY_STATUSES = [0, 1]
const ALREADY_HANDLED = '该创作者申请已被处理，请刷新列表'
// Only ordinary users are promoted; a concurrently promoted account is never
// pulled back to creator by a late approval.
const PROMOTABLE_ROLE = 1
const CREATOR_ROLE = 2

const loadApplicant = (uid: number) =>
  prisma.user.findUnique({
    where: { id: uid },
    include: { _count: { select: { patch_resource: true } } }
  })

export const approveCreator = async (
  input: z.infer<typeof approveCreatorSchema>,
  adminUid: number
) => {
  const { messageId, uid } = input
  const [creator, admin] = await Promise.all([
    loadApplicant(uid),
    prisma.user.findUnique({ where: { id: adminUid } })
  ])
  if (!creator) {
    return '未找到该创作者'
  }
  if (!admin) {
    return '未找到该管理员'
  }

  const result = await prisma.$transaction(async (tx) => {
    // Claim the application first; a concurrent or repeated review claims
    // nothing and leaves roles, notifications and the log untouched.
    const claimed = await tx.user_message.updateMany({
      where: {
        id: messageId,
        type: 'apply',
        recipient_id: null,
        sender_id: uid,
        status: { in: OPEN_APPLY_STATUSES }
      },
      data: { status: 2 }
    })
    if (claimed.count === 0) {
      const message = await tx.user_message.findUnique({
        where: { id: messageId },
        select: { sender_id: true }
      })
      if (!message) return '未找到该创作者请求'
      if (message.sender_id !== uid) return '创作者请求与用户不匹配'
      return ALREADY_HANDLED
    }

    const promoted = await tx.user.updateMany({
      where: { id: uid, role: PROMOTABLE_ROLE },
      data: { role: CREATOR_ROLE }
    })

    await createMessage(
      {
        type: 'apply',
        content: '恭喜! 您的创作者申请已经通过!',
        recipient_id: uid,
        link: '/apply/success'
      },
      tx
    )

    await tx.admin_log.create({
      data: {
        type: 'creator_review',
        user_id: adminUid,
        content: `管理员 ${admin.name} 同意了一位创作者申请\n\n创作者信息:\n用户名:${creator.name}\n已发布资源数:${creator._count.patch_resource}${
          promoted.count === 0 ? '\n该用户已不是普通用户，角色未改动' : ''
        }`
      }
    })

    return { promoted: promoted.count > 0 }
  })

  if (typeof result === 'string') {
    return result
  }
  if (result.promoted) {
    await updateKunSessions(uid, { role: CREATOR_ROLE })
  }
  return {}
}

export const declineCreator = async (
  input: z.infer<typeof declineCreatorSchema>,
  adminUid: number
) => {
  const { messageId, reason } = input
  const message = await prisma.user_message.findUnique({
    where: { id: messageId },
    select: { sender_id: true }
  })
  if (!message || message.sender_id === null) {
    return '未找到该创作者请求'
  }
  const [creator, admin] = await Promise.all([
    loadApplicant(message.sender_id),
    prisma.user.findUnique({ where: { id: adminUid } })
  ])
  if (!creator) {
    return '未找到该创作者'
  }
  if (!admin) {
    return '未找到该管理员'
  }

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.user_message.updateMany({
      where: {
        id: messageId,
        type: 'apply',
        recipient_id: null,
        sender_id: creator.id,
        status: { in: OPEN_APPLY_STATUSES }
      },
      data: { status: 3 }
    })
    if (claimed.count === 0) {
      return ALREADY_HANDLED
    }

    // Declining never touches the applicant's role.
    await createMessage(
      {
        type: 'apply',
        content: `您的创作者申请被拒绝, 理由: ${reason}`,
        recipient_id: creator.id,
        link: '/'
      },
      tx
    )

    await tx.admin_log.create({
      data: {
        type: 'creator_review',
        user_id: adminUid,
        content: `管理员 ${admin.name} 拒绝了一位创作者申请\n\n拒绝原因:${reason}\n创作者信息:\n用户名:${creator.name}\n已发布资源数:${creator._count.patch_resource}`
      }
    })

    return {}
  })
}
