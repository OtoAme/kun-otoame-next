import { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import { getShanghaiQuotaWindows } from '~/app/api/patch/resource/download/access/timeWindow'
import { INBOX_KINDS } from '~/types/api/inbox'
import type {
  InboxCounts,
  InboxItem,
  InboxItemResponse,
  InboxKind,
  InboxListResponse,
  InboxPayloads,
  InboxQuery
} from '~/types/api/inbox'
import type { AdminLegacyReport, AdminShoutboxReport } from '~/types/api/admin'
import type { PatchSubmissionStatus } from '~/types/api/patchSubmission'

const userSelect = { id: true, name: true, avatar: true } as const
const submissionSelect = {
  id: true,
  status: true,
  name: true,
  submitted_at: true,
  reviewed_at: true,
  updated: true,
  created: true,
  user: { select: userSelect }
} satisfies Prisma.patch_submissionSelect
const resourceSelect = {
  id: true,
  name: true,
  section: true,
  type: true,
  language: true,
  note: true,
  platform: true,
  download: true,
  status: true,
  user_id: true,
  patch_id: true,
  created: true,
  patch: { select: { name: true, unique_id: true } },
  user: {
    select: {
      ...userSelect,
      role: true,
      _count: { select: { patch_resource: true } }
    }
  },
  links: {
    orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      storage: true,
      size: true,
      code: true,
      password: true,
      hash: true,
      content: true,
      sort_order: true,
      download: true
    }
  }
} satisfies Prisma.patch_resourceSelect
const feedbackSelect = {
  id: true,
  type: true,
  content: true,
  status: true,
  link: true,
  created: true,
  sender: { select: userSelect }
} satisfies Prisma.user_messageSelect
const reportSelect = {
  id: true,
  target_type: true,
  status: true,
  reason: true,
  handler_reply: true,
  created: true,
  handled_at: true,
  comment_id: true,
  rating_id: true,
  sender: { select: userSelect },
  reported_user: { select: userSelect },
  patch: { select: { id: true, unique_id: true, name: true } },
  comment: { select: { id: true, content: true } },
  rating: {
    select: {
      id: true,
      short_summary: true,
      overall: true,
      recommend: true,
      play_status: true
    }
  },
  shoutbox: {
    select: {
      id: true,
      content: true,
      official: true,
      level: true,
      status: true,
      cost: true,
      created: true,
      hidden_at: true,
      refunded_at: true,
      patch_id: true,
      patch: { select: { id: true, unique_id: true, name: true } }
    }
  }
} satisfies Prisma.patch_reportSelect

type SubmissionRow = Prisma.patch_submissionGetPayload<{
  select: typeof submissionSelect
}>
type ResourceRow = Prisma.patch_resourceGetPayload<{
  select: typeof resourceSelect
}>
type FeedbackRow = Prisma.user_messageGetPayload<{
  select: typeof feedbackSelect
}>
type ReportRow = Prisma.patch_reportGetPayload<{ select: typeof reportSelect }>

const feedbackScope = {
  type: 'feedback',
  sender_id: { not: null },
  recipient_id: null
} as const
const oldestFirst = [{ created: 'asc' }, { id: 'asc' }] as const

const searchId = (search: string) => {
  if (!/^[1-9]\d*$/.test(search)) return undefined
  const id = Number(search)
  return Number.isSafeInteger(id) && id <= 2147483647 ? id : undefined
}

const pendingFilters = (search = '') => {
  const contains = { contains: search, mode: 'insensitive' } as const
  const id = searchId(search)
  const ids = id === undefined ? [] : [{ id }]
  return {
    submission: {
      status: 'pending',
      ...(search
        ? { OR: [{ name: contains }, { user: { name: contains } }, ...ids] }
        : {})
    } satisfies Prisma.patch_submissionWhereInput,
    resource: {
      status: 2,
      ...(search
        ? {
            OR: [
              { name: contains },
              { note: contains },
              { patch: { name: contains } },
              { user: { name: contains } },
              ...ids
            ]
          }
        : {})
    } satisfies Prisma.patch_resourceWhereInput,
    feedback: {
      ...feedbackScope,
      status: 0,
      ...(search
        ? {
            OR: [{ content: contains }, { sender: { name: contains } }, ...ids]
          }
        : {})
    } satisfies Prisma.user_messageWhereInput,
    report: {
      status: 0,
      OR: [
        { target_type: 'shoutbox', shoutbox_id: { not: null } },
        { target_type: { in: ['comment', 'rating'] }, patch_id: { not: null } }
      ],
      ...(search
        ? {
            AND: [
              {
                OR: [
                  { reason: contains },
                  { patch: { name: contains } },
                  { sender: { name: contains } },
                  { reported_user: { name: contains } },
                  { shoutbox: { content: contains } },
                  ...ids
                ]
              }
            ]
          }
        : {})
    } satisfies Prisma.patch_reportWhereInput
  }
}

const waiting = (date: Date, now: Date) => ({
  waitingFrom: date.toISOString(),
  waitingSeconds: Math.max(
    0,
    Math.floor((now.getTime() - date.getTime()) / 1000)
  )
})

const submissionItem = (row: SubmissionRow, now: Date): InboxItem => ({
  key: `submission:${row.id}`,
  kind: 'submission',
  id: row.id,
  title: row.name,
  subtitle: row.user.name,
  actor: row.user,
  ...waiting(row.submitted_at ?? row.created, now),
  targetHref: `/admin/submission/${row.id}`,
  badges: ['投稿'],
  readOnly: false,
  payload: {
    id: row.id,
    status: row.status as PatchSubmissionStatus,
    name: row.name,
    authorId: row.user.id,
    authorName: row.user.name,
    submittedAt: row.submitted_at?.toISOString() ?? null,
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
    updated: row.updated.toISOString(),
    created: row.created.toISOString()
  }
})

const resourceItem = (row: ResourceRow, now: Date): InboxItem => ({
  key: `resource-apply:${row.id}`,
  kind: 'resource-apply',
  id: row.id,
  title: row.name || row.patch.name,
  subtitle: row.patch.name,
  actor: { id: row.user.id, name: row.user.name, avatar: row.user.avatar },
  ...waiting(row.created, now),
  targetHref: `/${row.patch.unique_id}`,
  badges: ['资源申请', ...row.type],
  readOnly: false,
  payload: {
    id: row.id,
    name: row.name,
    section: row.section,
    uniqueId: row.patch.unique_id,
    patchName: row.patch.name,
    type: row.type,
    language: row.language,
    note: row.note,
    platform: row.platform,
    links: row.links.map((link) => ({
      id: link.id,
      storage: link.storage,
      size: link.size,
      code: link.code,
      password: link.password,
      hash: link.hash,
      content: link.content,
      sortOrder: link.sort_order,
      download: link.download
    })),
    download: row.download,
    likeCount: 0,
    isLike: false,
    status: row.status,
    userId: row.user_id,
    patchId: row.patch_id,
    created: row.created.toISOString(),
    user: {
      id: row.user.id,
      name: row.user.name,
      avatar: row.user.avatar,
      role: row.user.role,
      patchCount: row.user._count.patch_resource
    }
  }
})

const feedbackItem = (row: FeedbackRow, now: Date): InboxItem => ({
  key: `feedback:${row.id}`,
  kind: 'feedback',
  id: row.id,
  title: row.content.slice(0, 100),
  subtitle: row.sender?.name ?? '',
  actor: row.sender,
  ...waiting(row.created, now),
  targetHref: '/admin/feedback',
  badges: ['反馈', '只读'],
  readOnly: true,
  payload: {
    id: row.id,
    type: row.type,
    content: row.content,
    status: row.status,
    link: row.link,
    created: row.created.toISOString(),
    sender: row.sender
  }
})

const reportItem = async (
  row: ReportRow,
  now: Date
): Promise<InboxItem | null> => {
  if (row.target_type === 'shoutbox') {
    if (!row.shoutbox) return null
    const pendingForTarget = await prisma.patch_report.count({
      where: {
        status: 0,
        target_type: 'shoutbox',
        shoutbox_id: row.shoutbox.id,
        id: { not: row.id }
      }
    })
    const payload: AdminShoutboxReport & { pendingForTarget: number } = {
      id: row.id,
      targetType: 'shoutbox' as const,
      status: row.status,
      reason: row.reason,
      handlerReply: row.handler_reply,
      created: row.created.toISOString(),
      handledAt: row.handled_at?.toISOString() ?? null,
      sender: row.sender,
      reportedUser: row.reported_user,
      patch: row.shoutbox.patch
        ? {
            id: row.shoutbox.patch.id,
            uniqueId: row.shoutbox.patch.unique_id,
            name: row.shoutbox.patch.name
          }
        : null,
      shoutbox: {
        id: row.shoutbox.id,
        content: row.shoutbox.content,
        official: row.shoutbox.official,
        level: row.shoutbox.level,
        status: row.shoutbox.status,
        cost: row.shoutbox.cost,
        created: row.shoutbox.created.toISOString(),
        hiddenAt: row.shoutbox.hidden_at?.toISOString() ?? null,
        refundedAt: row.shoutbox.refunded_at?.toISOString() ?? null
      },
      comment: null,
      rating: null,
      pendingForTarget
    }
    return {
      key: `report:${row.id}`,
      kind: 'report',
      id: row.id,
      title: row.reason.slice(0, 100),
      subtitle: `小喇叭 · ${row.reported_user.name}`,
      actor: row.sender,
      ...waiting(row.created, now),
      targetHref: '/dashboard/shoutbox?tab=pending_review',
      badges: ['小喇叭举报'],
      readOnly: false,
      payload
    }
  }
  if (!row.patch || !['comment', 'rating'].includes(row.target_type)) {
    return null
  }
  const targetType = row.target_type === 'rating' ? 'rating' : 'comment'
  const targetId = targetType === 'rating' ? row.rating_id : row.comment_id
  const pendingForTarget =
    targetId === null
      ? 0
      : await prisma.patch_report.count({
          where: {
            status: 0,
            target_type: targetType,
            ...(targetType === 'rating'
              ? { rating_id: targetId }
              : { comment_id: targetId }),
            id: { not: row.id }
          }
        })
  const payload: AdminLegacyReport & { pendingForTarget: number } = {
    id: row.id,
    targetType,
    status: row.status,
    reason: row.reason,
    handlerReply: row.handler_reply,
    created: row.created.toISOString(),
    handledAt: row.handled_at?.toISOString() ?? null,
    sender: row.sender,
    reportedUser: row.reported_user,
    patch: {
      id: row.patch.id,
      uniqueId: row.patch.unique_id,
      name: row.patch.name
    },
    comment: row.comment,
    rating: row.rating
      ? {
          id: row.rating.id,
          shortSummary: row.rating.short_summary,
          overall: row.rating.overall,
          recommend: row.rating.recommend,
          playStatus: row.rating.play_status
        }
      : null,
    pendingForTarget
  }
  return {
    key: `report:${row.id}`,
    kind: 'report',
    id: row.id,
    title: row.reason.slice(0, 100),
    subtitle: `${row.patch.name} · ${row.reported_user.name}`,
    actor: row.sender,
    ...waiting(row.created, now),
    targetHref:
      targetType === 'rating' ? '/admin/rating-report' : '/admin/report',
    badges: [targetType === 'rating' ? '评价举报' : '评论举报', '只读'],
    readOnly: true,
    payload
  }
}

const listSubmissions = async (input: InboxQuery, now: Date) => {
  const where = pendingFilters(input.search).submission
  const id = searchId(input.search)
  const search = input.search
    ? Prisma.sql`AND (
    s.name ILIKE ${`%${input.search}%`} OR u.name ILIKE ${`%${input.search}%`}
    ${id === undefined ? Prisma.empty : Prisma.sql`OR s.id = ${id}`}
  )`
    : Prisma.empty
  const [ids, total] = await Promise.all([
    prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
      SELECT s.id FROM patch_submission s
      INNER JOIN "user" u ON u.id = s.user_id
      WHERE s.status = ${'pending'} ${search}
      ORDER BY COALESCE(s.submitted_at, s.created) ASC, s.id ASC
      LIMIT ${input.limitPerKind}
    `),
    prisma.patch_submission.count({ where })
  ])
  // The SQL window already includes NULL submitted_at rows in waiting order.
  const rows = ids.length
    ? await prisma.patch_submission.findMany({
        where: { ...where, id: { in: ids.map((row) => row.id) } },
        select: submissionSelect
      })
    : []
  return { total, items: rows.map((row) => submissionItem(row, now)) }
}

export const getAdminInbox = async (
  input: InboxQuery,
  now = new Date()
): Promise<InboxListResponse> => {
  const where = pendingFilters(input.search)
  const totals: InboxListResponse['totals'] = {
    submission: 0,
    'resource-apply': 0,
    feedback: 0,
    report: 0
  }
  const truncated: InboxListResponse['truncated'] = {
    submission: false,
    'resource-apply': false,
    feedback: false,
    report: false
  }
  const groups = await Promise.all(
    input.kinds.map(async (kind) => {
      let result: { total: number; items: InboxItem[] }
      if (kind === 'submission') {
        result = await listSubmissions(input, now)
      } else if (kind === 'resource-apply') {
        const [rows, total] = await Promise.all([
          prisma.patch_resource.findMany({
            where: where.resource,
            take: input.limitPerKind,
            orderBy: [...oldestFirst],
            select: resourceSelect
          }),
          prisma.patch_resource.count({ where: where.resource })
        ])
        result = { total, items: rows.map((row) => resourceItem(row, now)) }
      } else if (kind === 'feedback') {
        const [rows, total] = await Promise.all([
          prisma.user_message.findMany({
            where: where.feedback,
            take: input.limitPerKind,
            orderBy: [...oldestFirst],
            select: feedbackSelect
          }),
          prisma.user_message.count({ where: where.feedback })
        ])
        result = { total, items: rows.map((row) => feedbackItem(row, now)) }
      } else {
        const [rows, total] = await Promise.all([
          prisma.patch_report.findMany({
            where: where.report,
            take: input.limitPerKind,
            orderBy: [...oldestFirst],
            select: reportSelect
          }),
          prisma.patch_report.count({ where: where.report })
        ])
        const reportItems = await Promise.all(
          rows.map((row) => reportItem(row, now))
        )
        result = {
          total,
          items: reportItems.filter((item): item is InboxItem => item !== null)
        }
      }
      totals[kind] = result.total
      truncated[kind] = result.total > result.items.length
      return result.items
    })
  )
  const items = groups.flat().sort((a, b) => {
    const kindOrder = INBOX_KINDS.indexOf(a.kind) - INBOX_KINDS.indexOf(b.kind)
    if (input.order === 'kind' && kindOrder) return kindOrder
    return (
      Date.parse(a.waitingFrom) - Date.parse(b.waitingFrom) ||
      kindOrder ||
      a.id - b.id
    )
  })
  return { items, totals, truncated }
}

export const getAdminInboxItem = async (
  input: { kind: InboxKind; id: number },
  now = new Date()
): Promise<InboxItemResponse> => {
  const missing = { state: 'missing', item: null } as const
  if (input.kind === 'submission') {
    const row = await prisma.patch_submission.findUnique({
      where: { id: input.id },
      select: submissionSelect
    })
    return row
      ? {
          state: row.status === 'pending' ? 'pending' : 'processed',
          item: submissionItem(row, now)
        }
      : missing
  }
  if (input.kind === 'resource-apply') {
    const row = await prisma.patch_resource.findUnique({
      where: { id: input.id },
      select: resourceSelect
    })
    return row
      ? {
          state: row.status === 2 ? 'pending' : 'processed',
          item: resourceItem(row, now)
        }
      : missing
  }
  if (input.kind === 'feedback') {
    const row = await prisma.user_message.findFirst({
      where: { id: input.id, ...feedbackScope },
      select: feedbackSelect
    })
    return row
      ? {
          state: row.status === 0 ? 'pending' : 'processed',
          item: feedbackItem(row, now)
        }
      : missing
  }
  const row = await prisma.patch_report.findUnique({
    where: { id: input.id },
    select: reportSelect
  })
  if (!row) return missing
  if (
    row.target_type !== 'shoutbox' &&
    (!row.patch || !['comment', 'rating'].includes(row.target_type))
  ) {
    return missing
  }
  const item = await reportItem(row, now)
  return item
    ? { state: row.status === 0 ? 'pending' : 'processed', item }
    : missing
}

export const getAdminInboxCounts = async (
  reviewerId: number,
  now = new Date()
): Promise<InboxCounts> => {
  const where = pendingFilters()
  const { dailyStart, dailyResetAt } = getShanghaiQuotaWindows(now)
  const [submission, resource, feedback, report, todayProcessed] =
    await Promise.all([
      prisma.patch_submission.count({ where: where.submission }),
      prisma.patch_resource.count({ where: where.resource }),
      prisma.user_message.count({ where: where.feedback }),
      prisma.patch_report.count({ where: where.report }),
      prisma.admin_log.count({
        where: {
          user_id: reviewerId,
          created: { gte: dailyStart, lt: dailyResetAt },
          type: {
            in: [
              'submission_review',
              'resource_apply_approve',
              'resource_apply_decline'
            ]
          }
        }
      })
    ])
  return {
    pending: { submission, 'resource-apply': resource, feedback, report },
    todayProcessed
  }
}
