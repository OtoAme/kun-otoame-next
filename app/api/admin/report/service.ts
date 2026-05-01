import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { sliceUntilDelimiterFromEnd } from '~/app/api/utils/sliceUntilDelimiterFromEnd'
import {
  adminHandleReportSchema,
  adminReportPaginationSchema
} from '~/validations/admin'
import type { AdminReport } from '~/types/api/admin'
import { findRelatedReportIds, resolveReportMeta } from './_meta'

export const getReport = async (
  input: z.infer<typeof adminReportPaginationSchema>
) => {
  const { page, limit, tab } = input
  const offset = (page - 1) * limit
  const where = {
    type: 'report',
    sender_id: { not: null },
    ...(tab === 'pending' ? { status: 0 } : { status: { in: [2, 3] } })
  }

  const [data, total] = await Promise.all([
    prisma.user_message.findMany({
      where,
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            avatar: true
          }
        }
      },
      orderBy: { created: 'desc' },
      skip: offset,
      take: limit
    }),
    prisma.user_message.count({ where })
  ])

  const reportsWithMeta = await Promise.all(
    data.map(async (msg) => ({
      msg,
      meta: await resolveReportMeta(msg.content, msg.link)
    }))
  )

  const reportedUserIds = [
    ...new Set(
      reportsWithMeta
        .map(({ meta }) => meta.reportedUserId)
        .filter((id): id is number => !!id)
    )
  ]
  const reportedUsers = reportedUserIds.length
    ? await prisma.user.findMany({
        where: { id: { in: reportedUserIds } },
        select: {
          id: true,
          name: true,
          avatar: true
        }
      })
    : []
  const reportedUserMap = new Map(
    reportedUsers.map((user) => [
      user.id,
      { id: user.id, name: user.name, avatar: user.avatar }
    ])
  )

  const reports: AdminReport[] = reportsWithMeta.map(({ msg, meta }) => ({
    id: msg.id,
    type: msg.type,
    content: msg.content,
    status: msg.status,
    link: msg.link,
    created: msg.created,
    sender: msg.sender,
    reportedCommentId: meta.reportedCommentId,
    reportedUserId: meta.reportedUserId,
    reportedUser: meta.reportedUserId
      ? reportedUserMap.get(meta.reportedUserId) ?? null
      : null
  }))

  return { reports, total }
}

export const handleReport = async (
  input: z.infer<typeof adminHandleReportSchema>
) => {
  const message = await prisma.user_message.findUnique({
    where: { id: input.messageId }
  })
  if (!message) {
    return '该举报不存在'
  }
  if (message.status !== 0) {
    return '该举报已被处理'
  }

  const targetCommentId = input.commentId
    ? input.commentId
    : (await resolveReportMeta(message.content, message.link)).reportedCommentId

  const relatedReportIds =
    input.action === 'delete' && targetCommentId
      ? await findRelatedReportIds(targetCommentId, input.messageId)
      : []

  const SLICED_CONTENT = sliceUntilDelimiterFromEnd(message.content).slice(
    0,
    200
  )
  const defaultReply = input.action === 'reject' ? '已驳回' : '已处理'
  const handleResult = input.content ? input.content : defaultReply
  const reportStatus = input.action === 'reject' ? 3 : 2
  const reportResult =
    input.action === 'reject' ? '您的举报已驳回!' : '您的举报已处理!'
  const reportReplyLabel =
    input.action === 'reject' ? '举报驳回回复' : '举报处理回复'
  const reportContent = `${reportResult}\n\n举报原因: ${SLICED_CONTENT}\n${reportReplyLabel}: ${handleResult}`

  return prisma.$transaction(async (prisma) => {
    const messageIdsToHandle = [
      ...new Set([input.messageId, ...relatedReportIds])
    ]
    if (input.action === 'delete' && targetCommentId) {
      await prisma.patch_comment.deleteMany({
        where: { id: targetCommentId }
      })
    }

    const affectedReports = await prisma.user_message.findMany({
      where: {
        id: {
          in: messageIdsToHandle
        }
      },
      select: {
        sender_id: true
      }
    })

    await prisma.user_message.updateMany({
      where: {
        id: {
          in: messageIdsToHandle
        }
      },
      // status: 0 - unread, 1 - read, 2 - approve, 3 - decline
      data: { status: { set: reportStatus } }
    })

    const recipientIds = [
      ...new Set(
        affectedReports
          .map((report) => report.sender_id)
          .filter((id): id is number => !!id)
      )
    ]
    if (recipientIds.length) {
      await prisma.user_message.createMany({
        data: recipientIds.map((recipientId) => ({
          type: 'report',
          content: reportContent,
          recipient_id: recipientId,
          link: '/'
        }))
      })
    }

    return {}
  })
}
