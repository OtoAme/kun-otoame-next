import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { recomputePatchRatingStat } from '~/app/api/patch/rating/stat'
import {
  adminHandleReportSchema,
  adminReportPaginationSchema
} from '~/validations/admin'
import type { AdminReport } from '~/types/api/admin'

const buildReportNotice = (
  report: AdminReport,
  action: 'delete' | 'reject'
) => {
  const defaultReply = action === 'reject' ? '已驳回' : '已处理'
  const reportResult =
    action === 'reject' ? '您的举报已驳回!' : '您的举报已处理!'
  const reportReplyLabel = action === 'reject' ? '举报驳回回复' : '举报处理回复'
  const handleResult = report.handlerReply || defaultReply
  const targetLabel = report.targetType === 'rating' ? '评价' : '评论'

  return `${reportResult}\n\n举报类型: ${targetLabel}\n举报原因: ${report.reason.slice(0, 200)}\n${reportReplyLabel}: ${handleResult}`
}

const serializeReport = (report: {
  id: number
  target_type: string
  status: number
  reason: string
  handler_reply: string
  created: Date
  handled_at: Date | null
  sender: KunUser
  reported_user: KunUser
  patch: {
    id: number
    unique_id: string
    name: string
  }
  comment: {
    id: number
    content: string
  } | null
  rating: {
    id: number
    short_summary: string
    overall: number
    recommend: string
    play_status: string
  } | null
}): AdminReport => ({
  id: report.id,
  targetType: report.target_type === 'rating' ? 'rating' : 'comment',
  status: report.status,
  reason: report.reason,
  handlerReply: report.handler_reply,
  created: report.created,
  handledAt: report.handled_at,
  sender: report.sender,
  reportedUser: report.reported_user,
  patch: {
    id: report.patch.id,
    uniqueId: report.patch.unique_id,
    name: report.patch.name
  },
  comment: report.comment
    ? {
        id: report.comment.id,
        content: report.comment.content
      }
    : null,
  rating: report.rating
    ? {
        id: report.rating.id,
        shortSummary: report.rating.short_summary,
        overall: report.rating.overall,
        recommend: report.rating.recommend,
        playStatus: report.rating.play_status
      }
    : null
})

export const getReport = async (
  input: z.infer<typeof adminReportPaginationSchema>
) => {
  const { page, limit, tab, targetType } = input
  const offset = (page - 1) * limit
  const where = {
    target_type: targetType,
    ...(tab === 'pending' ? { status: 0 } : { status: { in: [2, 3] } })
  }

  const [data, total] = await Promise.all([
    prisma.patch_report.findMany({
      where,
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            avatar: true
          }
        },
        reported_user: {
          select: {
            id: true,
            name: true,
            avatar: true
          }
        },
        patch: {
          select: {
            id: true,
            unique_id: true,
            name: true
          }
        },
        comment: {
          select: {
            id: true,
            content: true
          }
        },
        rating: {
          select: {
            id: true,
            short_summary: true,
            overall: true,
            recommend: true,
            play_status: true
          }
        }
      },
      orderBy: { created: 'desc' },
      skip: offset,
      take: limit
    }),
    prisma.patch_report.count({ where })
  ])

  const reports: AdminReport[] = data.map(serializeReport)

  return { reports, total }
}

export const handleReport = async (
  input: z.infer<typeof adminHandleReportSchema>,
  handlerId: number
) => {
  const report = await prisma.patch_report.findUnique({
    where: { id: input.reportId },
    include: {
      sender: {
        select: {
          id: true,
          name: true,
          avatar: true
        }
      },
      reported_user: {
        select: {
          id: true,
          name: true,
          avatar: true
        }
      },
      patch: {
        select: {
          id: true,
          unique_id: true,
          name: true
        }
      },
      comment: {
        select: {
          id: true,
          content: true
        }
      },
      rating: {
        select: {
          id: true,
          short_summary: true,
          overall: true,
          recommend: true,
          play_status: true
        }
      }
    }
  })
  if (!report) {
    return '该举报不存在'
  }
  if (report.status !== 0) {
    return '该举报已被处理'
  }

  const serializedReport = serializeReport(report)
  const handleResult =
    input.content || (input.action === 'reject' ? '已驳回' : '已处理')
  const reportStatus = input.action === 'reject' ? 3 : 2
  const targetId =
    report.target_type === 'rating' ? report.rating_id : report.comment_id
  const relatedTargetWhere =
    targetId === null
      ? { id: report.id, status: 0 }
      : report.target_type === 'rating'
        ? { target_type: 'rating', rating_id: targetId, status: 0 }
        : { target_type: 'comment', comment_id: targetId, status: 0 }

  await prisma.$transaction(async (prisma) => {
    const affectedReports = await prisma.patch_report.findMany({
      where: relatedTargetWhere,
      select: {
        id: true,
        sender_id: true
      }
    })
    const affectedReportIds = affectedReports.map((item) => item.id)

    await prisma.patch_report.updateMany({
      where: { id: { in: affectedReportIds } },
      data: {
        status: reportStatus,
        handler_id: handlerId,
        handler_reply: handleResult,
        handled_at: new Date()
      }
    })

    if (input.action === 'delete') {
      if (report.target_type === 'rating' && report.rating_id) {
        await prisma.patch_rating.deleteMany({
          where: { id: report.rating_id }
        })
      }
      if (report.target_type === 'comment' && report.comment_id) {
        await prisma.patch_comment.deleteMany({
          where: { id: report.comment_id }
        })
      }
    }

    const recipientIds = [
      ...new Set(
        affectedReports.map((affectedReport) => affectedReport.sender_id)
      )
    ]
    if (recipientIds.length) {
      await prisma.user_message.createMany({
        data: recipientIds.map((recipientId) => ({
          type: 'report',
          content: buildReportNotice(
            { ...serializedReport, handlerReply: handleResult },
            input.action
          ),
          recipient_id: recipientId,
          link: `/${report.patch.unique_id}`
        }))
      })
    }
  })

  if (
    input.action === 'delete' &&
    report.target_type === 'rating' &&
    report.rating_id
  ) {
    await recomputePatchRatingStat(report.patch_id)
  }

  return {}
}
