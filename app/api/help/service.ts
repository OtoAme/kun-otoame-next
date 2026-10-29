import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import type { z } from 'zod'
import { prisma } from '~/prisma/index'
import {
  HELP_ANSWER_REWARD,
  HELP_DAILY_POST_LIMIT,
  HELP_DAILY_REWARD_LIMIT,
  HELP_IMAGE_MAX_PER_BODY,
  HELP_POINT_ELIGIBLE_AFTER_MS,
  HELP_POST_FEE,
  HELP_CATEGORIES,
  HELP_SIDEBAR_ITEM_LIMIT,
  HELP_SIMILAR_LIMIT,
  type HelpCategory,
  type HelpScope,
  type HelpStatus
} from '~/constants/help'
import { MOEMOEPOINT_REASON } from '~/constants/moemoepoint'
import {
  MoemoepointInsufficientError,
  earnMoemoepoint,
  getCurrentBalance,
  spendMoemoepoint
} from '~/app/api/moemoepoint/service'
import { getShanghaiQuotaWindows } from '~/app/api/patch/resource/download/access/timeWindow'
import { createMessage } from '~/app/api/utils/message'
import { markdownToHtml } from '~/app/api/utils/render/markdownToHtml'
import { markdownToText } from '~/utils/markdownToText'
import { kunMoyuMoe } from '~/config/moyu-moe'
import type {
  helpAcceptSchema,
  helpAnswerCreateSchema,
  helpAnswerUpdateSchema,
  helpListSchema,
  helpPostCreateSchema,
  helpPostUpdateSchema,
  helpReplyCreateSchema,
  helpReplyUpdateSchema,
  helpSimilarSchema
} from '~/validations/help'
import type {
  HelpAcceptResponse,
  HelpAnswer,
  HelpListResponse,
  HelpPatchLink,
  HelpPostCreateResponse,
  HelpPostDetail,
  HelpPostFormState,
  HelpPostSummary,
  HelpReply,
  HelpSidebarResponse,
  HelpSimilarItem,
  HelpUser
} from '~/types/api/help'

type Tx = Prisma.TransactionClient
type Db = PrismaClient
type Options = { now?: Date; db?: Db }
export type HelpViewer = { uid: number; role: number } | null

class HelpRollback extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HelpRollback'
  }
}

const rollback = (message: string): never => {
  throw new HelpRollback(message)
}

const isRetryable = (error: unknown) => {
  const text = String((error as { code?: unknown } | null)?.code ?? '').concat(
    ' ',
    String(error)
  )
  return /P2034|40001|40P01|TransactionWriteConflict/.test(text)
}

const isUniqueConflict = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'P2002' || code === '23505' || String(error).includes('23505')
}

/**
 * Every help write runs in one short transaction. A business refusal thrown
 * as HelpRollback undoes the whole write and comes back as its message; a
 * serialization or deadlock failure retries the whole callback a few times.
 */
const runHelpTransaction = async <T>(
  db: Db,
  operation: (tx: Tx) => Promise<T>
): Promise<T | string> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.$transaction(operation)
    } catch (error) {
      if (error instanceof HelpRollback) return error.message
      if (error instanceof MoemoepointInsufficientError) {
        return `可用萌萌点不足，发布求助需要 ${HELP_POST_FEE} 点`
      }
      if (!isRetryable(error) || attempt >= 2) throw error
      await new Promise((resolve) => setTimeout(resolve, 30 * (attempt + 1)))
    }
  }
}

/** Shanghai natural-day key, from the same window the download quota uses. */
export const helpDayKey = (now: Date) => {
  const { dailyStart } = getShanghaiQuotaWindows(now)
  const shanghai = new Date(dailyStart.getTime() + 8 * 60 * 60 * 1000)
  return shanghai.toISOString().slice(0, 10)
}

const lockPost = async (tx: Tx, postId: number) => {
  const rows = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    SELECT id FROM help_post WHERE id = ${postId} FOR UPDATE
  `)
  return rows.length > 0
}

const lockUser = async (tx: Tx, userId: number) => {
  const rows = await tx.$queryRaw<
    Array<{ id: number; register_time: Date }>
  >(Prisma.sql`
    SELECT id, register_time FROM "user" WHERE id = ${userId} FOR UPDATE
  `)
  return rows[0] ?? null
}

/** Count one use of a daily quota; false when the day's limit is reached. */
const consumeDailyQuota = async (
  tx: Tx,
  userId: number,
  day: string,
  field: 'post_count' | 'reward_count',
  limit: number
) => {
  await tx.help_daily_quota.createMany({
    data: [{ user_id: userId, day }],
    skipDuplicates: true
  })
  const updated = await tx.help_daily_quota.updateMany({
    where: { user_id: userId, day, [field]: { lt: limit } },
    data: { [field]: { increment: 1 } }
  })
  return updated.count === 1
}

const isPointEligible = (registerTime: Date, now: Date) =>
  registerTime.getTime() <= now.getTime() - HELP_POINT_ELIGIBLE_AFTER_MS

const MARKDOWN_IMAGE = /!\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/g

/** Image URLs in a markdown body, in order. */
export const helpBodyImages = (markdown: string) =>
  [...markdown.matchAll(MARKDOWN_IMAGE)].map((match) => match[1])

/**
 * Only https images (or http for a local test image host) become list
 * thumbnails; anything else is ignored rather than rendered.
 */
const firstImageOf = (markdown: string) =>
  helpBodyImages(markdown).find((url) => /^https?:\/\//i.test(url)) ?? null

const imageCountError = (markdown: string) =>
  helpBodyImages(markdown).length > HELP_IMAGE_MAX_PER_BODY
    ? `每条内容最多 ${HELP_IMAGE_MAX_PER_BODY} 张图片`
    : null

const postLink = (postId: number) => `/help/${postId}`
const answerLink = (postId: number, answerId: number) =>
  `/help/${postId}#answer-${answerId}`

const replyLink = (postId: number, replyId: number) =>
  `/help/${postId}#reply-${replyId}`

const clip = (text: string, length = 40) =>
  text.length > length ? `${text.slice(0, length)}…` : text

/**
 * Visible to this reader: no own hide or delete, and a linked game that
 * passes the reader's content limit and blocked tags. Posts without a game
 * link are always eligible.
 */
const publicPostWhere = (
  visibilityWhere: Prisma.patchWhereInput
): Prisma.help_postWhereInput => ({
  deleted_at: null,
  hidden_at: null,
  OR: [{ patch_id: null }, { patch: { status: 0, ...visibilityWhere } }]
})

const userSelect = { id: true, name: true, avatar: true } as const
const patchSelect = { id: true, unique_id: true, name: true } as const

const toUser = (user: HelpUser | null): HelpUser | null =>
  user ? { id: user.id, name: user.name, avatar: user.avatar } : null

const toPatch = (
  patch: { id: number; unique_id: string; name: string } | null
): HelpPatchLink | null =>
  patch ? { id: patch.id, uniqueId: patch.unique_id, name: patch.name } : null

/** Validates the optional game and resource link against current rows. */
const resolveLink = async (
  db: Tx | Db,
  input: {
    patchId?: number | null
    gameName: string
    gameLinks?: string[]
    resourceId?: number | null
  }
) => {
  const patchId = input.patchId ?? null
  const resourceId = input.resourceId ?? null
  if (patchId !== null) {
    const patch = await db.patch.findUnique({
      where: { id: patchId },
      select: { id: true, status: true }
    })
    if (!patch || patch.status !== 0) return '关联的游戏不存在或不可用'
  }
  if (resourceId !== null) {
    const resource = await db.patch_resource.findUnique({
      where: { id: resourceId },
      select: { patch_id: true, status: true }
    })
    if (!resource || resource.status !== 0 || resource.patch_id !== patchId) {
      return '关联的资源不存在或不属于该游戏'
    }
  }
  return {
    patch_id: patchId,
    game_name: patchId === null ? input.gameName.trim() : '',
    game_links:
      patchId === null && input.gameName.trim() ? (input.gameLinks ?? []) : [],
    resource_id: resourceId
  }
}

export const getHelpFormState = async (
  uid: number,
  options: Options = {}
): Promise<HelpPostFormState> => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const [balance, quota] = await Promise.all([
    getCurrentBalance(db as unknown as Tx, uid),
    db.help_daily_quota.findUnique({
      where: { user_id_day: { user_id: uid, day: helpDayKey(now) } },
      select: { post_count: true }
    })
  ])
  return {
    balance,
    postsToday: quota?.post_count ?? 0,
    dailyLimit: HELP_DAILY_POST_LIMIT,
    fee: HELP_POST_FEE
  }
}

/**
 * Posting costs the fee once, inside the same transaction as the post and the
 * day's count. A replayed request id returns the post it already created.
 */
export const createHelpPost = async (
  input: z.infer<typeof helpPostCreateSchema>,
  uid: number,
  options: Options = {}
): Promise<HelpPostCreateResponse | string> => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const replay = async () => {
    const existing = await db.help_post.findUnique({
      where: {
        user_id_request_id: { user_id: uid, request_id: input.requestId }
      },
      select: { id: true }
    })
    if (!existing) return null
    return {
      postId: existing.id,
      moemoepointBalance: await getCurrentBalance(db as unknown as Tx, uid)
    }
  }
  const replayed = await replay()
  if (replayed) return replayed
  const tooMany = imageCountError(input.content)
  if (tooMany) return tooMany

  try {
    const result = await runHelpTransaction(db, async (tx) => {
      const link = await resolveLink(tx, input)
      if (typeof link === 'string') return rollback(link)
      const post = await tx.help_post.create({
        data: {
          user_id: uid,
          request_id: input.requestId,
          category: input.category,
          title: input.title,
          content: input.content,
          ...link,
          created: now,
          updated: now
        },
        select: { id: true, title: true }
      })
      const change = await spendMoemoepoint(tx, {
        userId: uid,
        amount: HELP_POST_FEE,
        requiredAvailable: HELP_POST_FEE,
        reasonCode: MOEMOEPOINT_REASON.helpPostFee.code,
        reason: `${MOEMOEPOINT_REASON.helpPostFee.text}「${clip(post.title)}」`,
        referenceType: 'help_post',
        referenceId: post.id,
        link: postLink(post.id),
        idempotencyKey: `help:${post.id}:post-fee`
      })
      const allowed = await consumeDailyQuota(
        tx,
        uid,
        helpDayKey(now),
        'post_count',
        HELP_DAILY_POST_LIMIT
      )
      if (!allowed) {
        rollback(`每人每天最多发布 ${HELP_DAILY_POST_LIMIT} 条求助，请明天再试`)
      }
      if (link.resource_id !== null) {
        const resource = await tx.patch_resource.findUnique({
          where: { id: link.resource_id },
          select: { user_id: true, name: true }
        })
        if (resource && resource.user_id !== uid) {
          await createMessage(
            {
              type: 'feedback',
              content: `有用户就您的资源「${clip(resource.name)}」发布了求助：${clip(post.title)}`,
              sender_id: uid,
              recipient_id: resource.user_id,
              link: postLink(post.id)
            },
            tx
          )
        }
      }
      return { postId: post.id, moemoepointBalance: change.balance }
    })
    return result
  } catch (error) {
    if (!isUniqueConflict(error)) throw error
    const existing = await replay()
    if (!existing) throw error
    return existing
  }
}

export const updateHelpPost = async (
  input: z.infer<typeof helpPostUpdateSchema>,
  uid: number,
  options: Options = {}
) => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const tooMany = imageCountError(input.content)
  if (tooMany) return tooMany
  return runHelpTransaction(db, async (tx) => {
    if (!(await lockPost(tx, input.postId))) return rollback('求助不存在')
    const post = await tx.help_post.findUnique({
      where: { id: input.postId },
      select: { user_id: true, deleted_at: true }
    })
    if (!post || post.deleted_at) return rollback('求助不存在')
    if (post.user_id !== uid) return rollback('只能编辑自己的求助')
    const link = await resolveLink(tx, input)
    if (typeof link === 'string') return rollback(link)
    await tx.help_post.update({
      where: { id: input.postId },
      data: {
        category: input.category,
        title: input.title,
        content: input.content,
        ...link,
        updated: now
      }
    })
    return { postId: input.postId }
  })
}

/**
 * The asker may delete only while nobody else has answered; the check and
 * the delete hold the post lock that new answers also take.
 */
export const deleteHelpPost = async (
  postId: number,
  uid: number,
  options: Options = {}
) => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  return runHelpTransaction(db, async (tx) => {
    if (!(await lockPost(tx, postId))) return rollback('求助不存在')
    const post = await tx.help_post.findUnique({
      where: { id: postId },
      select: { user_id: true, deleted_at: true }
    })
    if (!post || post.deleted_at) return rollback('求助不存在')
    if (post.user_id !== uid) return rollback('只能删除自己的求助')
    const others = await tx.help_answer.count({
      where: {
        post_id: postId,
        deleted_at: null,
        // An answer whose author later deleted the account still counts.
        OR: [{ user_id: null }, { user_id: { not: uid } }]
      }
    })
    if (others > 0) {
      return rollback(
        '已有其他用户回答，不能删除求助；可以编辑正文，确需删除请联系网站管理员'
      )
    }
    await tx.help_post.update({
      where: { id: postId },
      data: { deleted_at: now }
    })
    return { postId }
  })
}

const FOLLOW_ANSWER_NOTICE = /^您关注的求助「.*」有 (\d+) 条新回答$/

/**
 * Followers hear about new answers once per unread notice: while a
 * follower's notice for this post is still unread its count goes up, and a
 * new notice starts only after they read it. Replies under answers do not
 * notify followers.
 */
const notifyFollowersOfAnswer = async (
  tx: Tx,
  input: {
    postId: number
    title: string
    answererId: number
    askerId: number | null
  }
) => {
  const followers = await tx.help_follow.findMany({
    where: {
      post_id: input.postId,
      NOT: { user_id: { in: [input.answererId, input.askerId ?? 0] } }
    },
    select: { user_id: true }
  })
  if (!followers.length) return
  const link = postLink(input.postId)
  for (const { user_id } of followers) {
    const unread = await tx.user_message.findFirst({
      where: { recipient_id: user_id, status: 0, type: 'system', link },
      orderBy: { id: 'desc' },
      select: { id: true, content: true }
    })
    const count = unread?.content.match(FOLLOW_ANSWER_NOTICE)?.[1]
    const content = (n: number) =>
      `您关注的求助「${clip(input.title)}」有 ${n} 条新回答`
    if (unread && count) {
      await tx.user_message.update({
        where: { id: unread.id },
        data: { content: content(Number(count) + 1), created: new Date() }
      })
    } else {
      await createMessage(
        { type: 'system', content: content(1), recipient_id: user_id, link },
        tx
      )
    }
  }
}

export const createHelpAnswer = async (
  input: z.infer<typeof helpAnswerCreateSchema>,
  uid: number,
  options: Options = {}
) => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const replay = async () => {
    const existing = await db.help_answer.findUnique({
      where: {
        user_id_request_id: { user_id: uid, request_id: input.requestId }
      },
      select: { id: true, post_id: true }
    })
    if (!existing) return null
    if (existing.post_id !== input.postId)
      return '请求标识已被使用，请刷新后重试'
    return { answerId: existing.id }
  }
  const replayed = await replay()
  if (replayed) return replayed
  const tooMany = imageCountError(input.content)
  if (tooMany) return tooMany

  try {
    return await runHelpTransaction(db, async (tx) => {
      if (!(await lockPost(tx, input.postId))) return rollback('求助不存在')
      const post = await tx.help_post.findUnique({
        where: { id: input.postId },
        select: {
          user_id: true,
          title: true,
          deleted_at: true,
          hidden_at: true
        }
      })
      if (!post || post.deleted_at) return rollback('求助不存在')
      if (post.hidden_at) return rollback('该求助已被隐藏，暂时不能回答')
      const answer = await tx.help_answer.create({
        data: {
          post_id: input.postId,
          user_id: uid,
          request_id: input.requestId,
          content: input.content,
          created: now,
          updated: now
        },
        select: { id: true }
      })
      if (post.user_id !== null && post.user_id !== uid) {
        await createMessage(
          {
            type: 'comment',
            content: `回答了您的求助「${clip(post.title)}」`,
            sender_id: uid,
            recipient_id: post.user_id,
            link: answerLink(input.postId, answer.id)
          },
          tx
        )
      }
      await notifyFollowersOfAnswer(tx, {
        postId: input.postId,
        title: post.title,
        answererId: uid,
        askerId: post.user_id
      })
      return { answerId: answer.id }
    })
  } catch (error) {
    if (!isUniqueConflict(error)) throw error
    const existing = await replay()
    if (!existing) throw error
    return existing
  }
}

export const updateHelpAnswer = async (
  input: z.infer<typeof helpAnswerUpdateSchema>,
  uid: number,
  options: Options = {}
) => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const tooMany = imageCountError(input.content)
  if (tooMany) return tooMany
  const updated = await db.help_answer.updateMany({
    where: { id: input.answerId, user_id: uid, deleted_at: null },
    data: { content: input.content, updated: now }
  })
  if (updated.count !== 1) return '回答不存在或不能编辑'
  return { answerId: input.answerId }
}

/** An accepted answer stays until the asker changes or cancels acceptance. */
export const deleteHelpAnswer = async (
  answerId: number,
  uid: number,
  options: Options = {}
) => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const answer = await db.help_answer.findUnique({
    where: { id: answerId },
    select: { post_id: true }
  })
  if (!answer) return '回答不存在'
  return runHelpTransaction(db, async (tx) => {
    await lockPost(tx, answer.post_id)
    const [row, post] = await Promise.all([
      tx.help_answer.findUnique({
        where: { id: answerId },
        select: { user_id: true, deleted_at: true }
      }),
      tx.help_post.findUnique({
        where: { id: answer.post_id },
        select: { accepted_answer_id: true }
      })
    ])
    if (!row || row.deleted_at) return rollback('回答不存在')
    if (row.user_id !== uid) return rollback('只能删除自己的回答')
    if (post?.accepted_answer_id === answerId) {
      return rollback('已被采纳的回答不能删除，可以编辑内容')
    }
    await tx.help_answer.update({
      where: { id: answerId },
      data: { deleted_at: now }
    })
    return { answerId }
  })
}

/**
 * Accept, change or cancel acceptance. The 3-point reward goes once per post,
 * to the first accepted answer that qualifies; later changes never move or
 * take it back. An unqualified acceptance leaves the reward slot open.
 */
export const acceptHelpAnswer = async (
  input: z.infer<typeof helpAcceptSchema>,
  uid: number,
  options: Options = {}
): Promise<HelpAcceptResponse | string> => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  return runHelpTransaction(db, async (tx) => {
    if (!(await lockPost(tx, input.postId))) return rollback('求助不存在')
    const post = await tx.help_post.findUnique({
      where: { id: input.postId },
      select: {
        id: true,
        user_id: true,
        title: true,
        status: true,
        deleted_at: true,
        accepted_answer_id: true,
        rewarded_answer_id: true
      }
    })
    if (!post || post.deleted_at) return rollback('求助不存在')
    if (post.user_id !== uid) return rollback('只有提问者可以采纳回答')

    if (input.answerId === null) {
      await tx.help_post.update({
        where: { id: post.id },
        data: { accepted_answer_id: null, status: 'open' }
      })
      return { status: 'open', acceptedAnswerId: null, rewarded: false }
    }

    const answer = await tx.help_answer.findUnique({
      where: { id: input.answerId },
      select: {
        id: true,
        post_id: true,
        user_id: true,
        deleted_at: true,
        hidden_at: true
      }
    })
    if (
      !answer ||
      answer.post_id !== post.id ||
      answer.deleted_at ||
      answer.hidden_at
    ) {
      return rollback('回答不存在或不能采纳')
    }
    if (answer.user_id === uid) return rollback('不能采纳自己的回答')
    if (post.accepted_answer_id === answer.id) {
      return { status: 'solved', acceptedAnswerId: answer.id, rewarded: false }
    }
    const wasOpen = post.status !== 'solved'
    await tx.help_post.update({
      where: { id: post.id },
      data: { accepted_answer_id: answer.id, status: 'solved' }
    })

    let rewarded = false
    if (post.rewarded_answer_id === null && answer.user_id !== null) {
      const asker = await tx.user.findUnique({
        where: { id: uid },
        select: { register_time: true }
      })
      const answerer = await lockUser(tx, answer.user_id)
      if (
        asker &&
        answerer &&
        isPointEligible(asker.register_time, now) &&
        isPointEligible(new Date(answerer.register_time), now) &&
        (await consumeDailyQuota(
          tx,
          answer.user_id,
          helpDayKey(now),
          'reward_count',
          HELP_DAILY_REWARD_LIMIT
        ))
      ) {
        const claimed = await tx.help_post.updateMany({
          where: { id: post.id, rewarded_answer_id: null },
          data: { rewarded_answer_id: answer.id }
        })
        if (claimed.count !== 1) rollback('采纳状态刚刚变化，请刷新后重试')
        const change = await earnMoemoepoint(tx, {
          userId: answer.user_id,
          amount: HELP_ANSWER_REWARD,
          reasonCode: MOEMOEPOINT_REASON.helpAnswerReward.code,
          reason: `${MOEMOEPOINT_REASON.helpAnswerReward.text}「${clip(post.title)}」`,
          referenceType: 'help_answer',
          referenceId: answer.id,
          link: answerLink(post.id, answer.id),
          idempotencyKey: `help:${post.id}:answer-reward`
        })
        rewarded = change.applied
      }
    }

    if (answer.user_id !== null) {
      await createMessage(
        {
          type: 'system',
          content: rewarded
            ? `您在求助「${clip(post.title)}」中的回答被采纳，获得 ${HELP_ANSWER_REWARD} 萌萌点`
            : `您在求助「${clip(post.title)}」中的回答被采纳`,
          sender_id: uid,
          recipient_id: answer.user_id,
          link: answerLink(post.id, answer.id)
        },
        tx
      )
    }
    if (wasOpen) {
      const followers = await tx.help_follow.findMany({
        where: {
          post_id: post.id,
          NOT: { user_id: { in: [uid, answer.user_id ?? 0] } }
        },
        select: { user_id: true }
      })
      for (const follower of followers) {
        await createMessage(
          {
            type: 'system',
            content: `您关注的求助「${clip(post.title)}」已解决`,
            recipient_id: follower.user_id,
            link: answerLink(post.id, answer.id)
          },
          tx
        )
      }
    }
    return { status: 'solved', acceptedAnswerId: answer.id, rewarded }
  })
}

/** 「有用」: one per user per answer, never on one's own answer. */
export const setHelpAnswerUseful = async (
  answerId: number,
  active: boolean,
  uid: number,
  options: Options = {}
) => {
  const db = options.db ?? prisma
  const answer = await db.help_answer.findUnique({
    where: { id: answerId },
    select: {
      user_id: true,
      deleted_at: true,
      hidden_at: true,
      post: { select: { deleted_at: true, hidden_at: true } }
    }
  })
  if (
    !answer ||
    answer.deleted_at ||
    answer.hidden_at ||
    answer.post.deleted_at ||
    answer.post.hidden_at
  ) {
    return '回答不存在'
  }
  if (answer.user_id === uid) return '不能给自己的回答点「有用」'
  if (active) {
    await db.help_answer_vote.createMany({
      data: [{ answer_id: answerId, user_id: uid }],
      skipDuplicates: true
    })
  } else {
    await db.help_answer_vote.deleteMany({
      where: { answer_id: answerId, user_id: uid }
    })
  }
  const usefulCount = await db.help_answer_vote.count({
    where: { answer_id: answerId }
  })
  return { usefulCount, isUseful: active }
}

/** 「关注」: follow the post; the asker already follows their own. */
export const setHelpFollow = async (
  postId: number,
  active: boolean,
  uid: number,
  options: Options = {}
) => {
  const db = options.db ?? prisma
  const post = await db.help_post.findUnique({
    where: { id: postId },
    select: { user_id: true, deleted_at: true, hidden_at: true }
  })
  if (!post || post.deleted_at || post.hidden_at) return '求助不存在'
  if (post.user_id === uid) return '提问者会自动收到自己求助的通知'
  if (active) {
    await db.help_follow.createMany({
      data: [{ post_id: postId, user_id: uid }],
      skipDuplicates: true
    })
  } else {
    await db.help_follow.deleteMany({
      where: { post_id: postId, user_id: uid }
    })
  }
  const followCount = await db.help_follow.count({ where: { post_id: postId } })
  return { followCount, isFollowing: active }
}

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A bare resource-card share link (`/{game}?...resourceId=N`, absolute on
 * this site or relative) becomes a markdown link titled with the resource
 * name. Links to hidden, pending or deleted resources stay as they are, so
 * they show as plain links and leak no name.
 */
const linkResourceCards = async (
  db: Db,
  markdowns: string[],
  visibilityWhere: Prisma.patchWhereInput
) => {
  const site = escapeRegExp(kunMoyuMoe.domain.main.replace(/\/+$/, ''))
  const pattern = new RegExp(
    `(?<=^|\\s)(?:${site})?/([A-Za-z0-9]{8})\\?[^\\s)<>]*?\\bresourceId=(\\d+)[^\\s)<>]*`,
    'g'
  )
  const ids = new Set<number>()
  for (const markdown of markdowns) {
    for (const match of markdown.matchAll(pattern)) {
      const id = Number(match[2])
      if (Number.isSafeInteger(id) && id > 0) ids.add(id)
    }
  }
  if (!ids.size) return markdowns
  const resources = await db.patch_resource.findMany({
    where: {
      id: { in: [...ids].slice(0, 50) },
      status: 0,
      patch: { status: 0, ...visibilityWhere }
    },
    select: { id: true, name: true, patch: { select: { unique_id: true } } }
  })
  const byId = new Map(resources.map((resource) => [resource.id, resource]))
  return markdowns.map((markdown) =>
    markdown.replace(pattern, (url, uniqueId: string, rawId: string) => {
      const resource = byId.get(Number(rawId))
      if (!resource || resource.patch.unique_id !== uniqueId) return url
      const title = resource.name.replace(/[[\]]/g, '')
      return `[资源：${title}](${url})`
    })
  )
}

const excerptOf = (content: string) =>
  markdownToText(content.replace(MARKDOWN_IMAGE, ' '))
    .replace(/\s+/g, ' ')
    .slice(0, 160)

/**
 * Replies sit one level under an answer. They can be written while the answer
 * and its post are visible; the answer author is notified, and so is the
 * user named by `replyToUserId` when that user already took part in the
 * thread (answer author or an earlier replier).
 */
export const createHelpReply = async (
  input: z.infer<typeof helpReplyCreateSchema>,
  uid: number,
  options: Options = {}
) => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const replay = async () => {
    const existing = await db.help_reply.findUnique({
      where: {
        user_id_request_id: { user_id: uid, request_id: input.requestId }
      },
      select: { id: true, answer_id: true }
    })
    if (!existing) return null
    if (existing.answer_id !== input.answerId) {
      return '请求标识已被使用，请刷新后重试'
    }
    return { replyId: existing.id }
  }
  const replayed = await replay()
  if (replayed) return replayed
  const answer = await db.help_answer.findUnique({
    where: { id: input.answerId },
    select: { post_id: true }
  })
  if (!answer) return '回答不存在'

  try {
    return await runHelpTransaction(db, async (tx) => {
      if (!(await lockPost(tx, answer.post_id))) return rollback('求助不存在')
      const row = await tx.help_answer.findUnique({
        where: { id: input.answerId },
        select: {
          user_id: true,
          deleted_at: true,
          hidden_at: true,
          post: {
            select: { id: true, title: true, deleted_at: true, hidden_at: true }
          }
        }
      })
      if (!row || row.deleted_at || row.post.deleted_at) {
        return rollback('回答不存在')
      }
      if (row.hidden_at || row.post.hidden_at) {
        return rollback('该内容已被隐藏，暂时不能回复')
      }
      let replyTo: number | null = input.replyToUserId ?? null
      if (replyTo !== null && replyTo !== row.user_id) {
        const took = await tx.help_reply.count({
          where: {
            answer_id: input.answerId,
            user_id: replyTo,
            deleted_at: null
          }
        })
        if (took === 0) replyTo = null
      }
      if (replyTo === uid) replyTo = null
      const reply = await tx.help_reply.create({
        data: {
          answer_id: input.answerId,
          user_id: uid,
          reply_to_user_id: replyTo,
          request_id: input.requestId,
          content: input.content,
          created: now,
          updated: now
        },
        select: { id: true }
      })
      const recipients = new Set<number>()
      if (row.user_id !== null && row.user_id !== uid)
        recipients.add(row.user_id)
      if (replyTo !== null) recipients.add(replyTo)
      for (const recipient of recipients) {
        await createMessage(
          {
            type: 'comment',
            content: `在求助「${clip(row.post.title)}」中回复了您：${clip(input.content, 60)}`,
            sender_id: uid,
            recipient_id: recipient,
            link: replyLink(row.post.id, reply.id)
          },
          tx
        )
      }
      return { replyId: reply.id }
    })
  } catch (error) {
    if (!isUniqueConflict(error)) throw error
    const existing = await replay()
    if (!existing) throw error
    return existing
  }
}

export const updateHelpReply = async (
  input: z.infer<typeof helpReplyUpdateSchema>,
  uid: number,
  options: Options = {}
) => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const updated = await db.help_reply.updateMany({
    where: { id: input.replyId, user_id: uid, deleted_at: null },
    data: { content: input.content, updated: now }
  })
  if (updated.count !== 1) return '回复不存在或不能编辑'
  return { replyId: input.replyId }
}

/** Replies are never accepted, so their author may always delete them. */
export const deleteHelpReply = async (
  replyId: number,
  uid: number,
  options: Options = {}
) => {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const deleted = await db.help_reply.updateMany({
    where: { id: replyId, user_id: uid, deleted_at: null },
    data: { deleted_at: now }
  })
  if (deleted.count !== 1) return '回复不存在或不能删除'
  return { replyId }
}

/**
 * Sidebar: post counts per category for this reader, and for a signed-in
 * reader their latest own and followed posts.
 */
export const getHelpSidebar = async (
  viewer: HelpViewer,
  visibilityWhere: Prisma.patchWhereInput,
  options: Options & { status?: HelpStatus; scope?: HelpScope } = {}
): Promise<HelpSidebarResponse> => {
  const db = options.db ?? prisma
  const base = publicPostWhere(visibilityWhere)
  // Counts follow the list's scope and status tab so a category shows what
  // clicking it would list; the own lists below stay unfiltered.
  const scoped = scopeWhere(options.scope ?? 'all', viewer, visibilityWhere)
  const counted: Prisma.help_postWhereInput = options.status
    ? { AND: [scoped, { status: options.status }] }
    : scoped
  const mineWhere = scopeWhere('mine', viewer, visibilityWhere)
  const followedWhere = scopeWhere('followed', viewer, visibilityWhere)
  const [groups, total, mine, followed, mineTotal, followedTotal] =
    await Promise.all([
      db.help_post.groupBy({
        by: ['category'],
        where: counted,
        _count: { _all: true }
      }),
      db.help_post.count({ where: counted }),
      viewer
        ? db.help_post.findMany({
            where: mineWhere,
            orderBy: [{ created: 'desc' }, { id: 'desc' }],
            take: HELP_SIDEBAR_ITEM_LIMIT,
            select: { id: true, title: true, status: true }
          })
        : Promise.resolve([]),
      viewer
        ? db.help_post.findMany({
            where: followedWhere,
            orderBy: [{ created: 'desc' }, { id: 'desc' }],
            take: HELP_SIDEBAR_ITEM_LIMIT,
            select: { id: true, title: true, status: true }
          })
        : Promise.resolve([]),
      viewer ? db.help_post.count({ where: mineWhere }) : Promise.resolve(0),
      viewer ? db.help_post.count({ where: followedWhere }) : Promise.resolve(0)
    ])
  const counts = Object.fromEntries(
    HELP_CATEGORIES.map((category) => [category, 0])
  ) as Record<HelpCategory, number>
  for (const group of groups) {
    if ((HELP_CATEGORIES as readonly string[]).includes(group.category)) {
      counts[group.category as HelpCategory] = group._count._all
    }
  }
  const toItem = (row: { id: number; title: string; status: string }) => ({
    id: row.id,
    title: row.title,
    status: row.status as HelpStatus
  })
  return {
    total,
    categoryCounts: counts,
    mine: viewer ? { items: mine.map(toItem), total: mineTotal } : null,
    followed: viewer
      ? { items: followed.map(toItem), total: followedTotal }
      : null
  }
}

const visibleAnswerWhere = {
  deleted_at: null,
  hidden_at: null
} satisfies Prisma.help_answerWhereInput

/**
 * Base filter for a list scope. 我发布的 also shows the reader's own hidden
 * posts, which they can still open; 我关注的 keeps the public rules. A scope
 * that needs a reader returns no rows for guests.
 */
const scopeWhere = (
  scope: HelpScope,
  viewer: HelpViewer,
  visibilityWhere: Prisma.patchWhereInput
): Prisma.help_postWhereInput => {
  if (scope === 'mine') {
    return viewer
      ? { user_id: viewer.uid, deleted_at: null }
      : { id: { in: [] } }
  }
  if (scope === 'followed') {
    return viewer
      ? {
          ...publicPostWhere(visibilityWhere),
          follows: { some: { user_id: viewer.uid } }
        }
      : { id: { in: [] } }
  }
  return publicPostWhere(visibilityWhere)
}

export const listHelpPosts = async (
  input: z.infer<typeof helpListSchema>,
  visibilityWhere: Prisma.patchWhereInput,
  options: Options & { viewer?: HelpViewer } = {}
): Promise<HelpListResponse> => {
  const db = options.db ?? prisma
  const where: Prisma.help_postWhereInput = {
    AND: [
      scopeWhere(input.scope, options.viewer ?? null, visibilityWhere),
      input.category ? { category: input.category } : {},
      input.status ? { status: input.status } : {},
      input.patchId ? { patch_id: input.patchId } : {},
      input.sort === 'unanswered'
        ? { answers: { none: visibleAnswerWhere } }
        : {}
    ]
  }
  const [rows, total] = await Promise.all([
    db.help_post.findMany({
      where,
      orderBy: [{ created: 'desc' }, { id: 'desc' }],
      skip: (input.page - 1) * input.limit,
      take: input.limit,
      select: {
        id: true,
        category: true,
        title: true,
        content: true,
        status: true,
        game_name: true,
        game_links: true,
        created: true,
        user: { select: userSelect },
        patch: { select: patchSelect },
        _count: {
          select: {
            answers: { where: visibleAnswerWhere },
            follows: true
          }
        }
      }
    }),
    db.help_post.count({ where })
  ])
  const posts: HelpPostSummary[] = rows.map((row) => ({
    id: row.id,
    category: row.category as HelpCategory,
    title: row.title,
    excerpt: excerptOf(row.content),
    status: row.status as HelpStatus,
    user: toUser(row.user),
    patch: toPatch(row.patch),
    gameName: row.game_name,
    gameLinkCount: row.game_links.length,
    answerCount: row._count.answers,
    followCount: row._count.follows,
    thumbnail: firstImageOf(row.content),
    created: row.created.toISOString()
  }))
  return { posts, total }
}

/** Similar posts for the create form: same game first, then title words. */
export const getSimilarHelpPosts = async (
  input: z.infer<typeof helpSimilarSchema>,
  visibilityWhere: Prisma.patchWhereInput,
  options: Options = {}
): Promise<HelpSimilarItem[]> => {
  const db = options.db ?? prisma
  const words = [
    ...new Set(
      input.title
        .split(/[\s,，。.!?！？、:：;；/\\|()（）【】[\]「」"'“”]+/)
        .map((word) => word.trim())
        .filter((word) => word.length >= 2)
    )
  ].slice(0, 4)
  const match: Prisma.help_postWhereInput[] = [
    ...(input.patchId ? [{ patch_id: input.patchId }] : []),
    ...words.map((word) => ({
      title: { contains: word, mode: 'insensitive' as const }
    }))
  ]
  if (!match.length) return []
  const rows = await db.help_post.findMany({
    where: { AND: [publicPostWhere(visibilityWhere), { OR: match }] },
    orderBy: [{ status: 'desc' }, { created: 'desc' }],
    take: HELP_SIMILAR_LIMIT,
    select: {
      id: true,
      title: true,
      status: true,
      _count: { select: { answers: { where: visibleAnswerWhere } } }
    }
  })
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status as HelpStatus,
    answerCount: row._count.answers
  }))
}

const patchVisible = async (
  db: Db,
  patchId: number,
  visibilityWhere: Prisma.patchWhereInput
) =>
  (await db.patch.count({
    where: { id: patchId, status: 0, ...visibilityWhere }
  })) > 0

/**
 * Detail for one reader. A hidden post stays readable to its asker and site
 * administrators; a hidden answer to its own author, the asker and site
 * administrators, always marked as hidden.
 */
export const getHelpPost = async (
  postId: number,
  viewer: HelpViewer,
  visibilityWhere: Prisma.patchWhereInput,
  options: Options = {}
): Promise<HelpPostDetail | string> => {
  const db = options.db ?? prisma
  const post = await db.help_post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      user_id: true,
      category: true,
      title: true,
      content: true,
      status: true,
      game_name: true,
      game_links: true,
      accepted_answer_id: true,
      hidden_at: true,
      deleted_at: true,
      created: true,
      updated: true,
      user: { select: userSelect },
      patch: { select: { ...patchSelect, status: true } },
      resource: {
        select: { id: true, name: true, section: true, status: true }
      },
      _count: { select: { follows: true } }
    }
  })
  const isAdmin = (viewer?.role ?? 0) >= 3
  const isAuthor = viewer !== null && post?.user_id === viewer.uid
  if (!post || post.deleted_at) return '求助不存在或已删除'
  if (post.hidden_at && !isAuthor && !isAdmin) return '求助不存在或已删除'
  const patch = post.patch && post.patch.status === 0 ? post.patch : null
  if (
    patch &&
    !isAuthor &&
    !isAdmin &&
    !(await patchVisible(db, patch.id, visibilityWhere))
  ) {
    return '求助不存在或已删除'
  }

  const answers = await db.help_answer.findMany({
    where: { post_id: postId, deleted_at: null },
    orderBy: [{ created: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      user_id: true,
      content: true,
      hidden_at: true,
      created: true,
      updated: true,
      user: { select: userSelect },
      _count: { select: { votes: true } }
    }
  })
  const answerIds = answers.map((answer) => answer.id)
  const replies = answerIds.length
    ? await db.help_reply.findMany({
        where: { answer_id: { in: answerIds }, deleted_at: null },
        orderBy: [{ created: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          answer_id: true,
          user_id: true,
          content: true,
          hidden_at: true,
          created: true,
          updated: true,
          user: { select: userSelect },
          reply_to_user: { select: userSelect }
        }
      })
    : []
  const repliesByAnswer = new Map<number, HelpReply[]>()
  for (const reply of replies) {
    const own = viewer !== null && reply.user_id === viewer.uid
    // Same visibility rule as answers: a hidden reply stays readable to its
    // author, the asker and site administrators.
    if (reply.hidden_at && !own && !isAdmin && !isAuthor) continue
    const list = repliesByAnswer.get(reply.answer_id) ?? []
    list.push({
      id: reply.id,
      content: reply.content,
      user: toUser(reply.user),
      replyTo: toUser(reply.reply_to_user),
      hidden: reply.hidden_at !== null,
      canEdit: own,
      created: reply.created.toISOString(),
      updated: reply.updated.toISOString()
    })
    repliesByAnswer.set(reply.answer_id, list)
  }
  const [myVotes, following] = await Promise.all([
    viewer && answerIds.length
      ? db.help_answer_vote.findMany({
          where: { user_id: viewer.uid, answer_id: { in: answerIds } },
          select: { answer_id: true }
        })
      : Promise.resolve([]),
    viewer
      ? db.help_follow.findUnique({
          where: { post_id_user_id: { post_id: postId, user_id: viewer.uid } },
          select: { id: true }
        })
      : Promise.resolve(null)
  ])
  const voted = new Set(myVotes.map((vote) => vote.answer_id))
  const visibleAnswers = answers.filter(
    (answer) =>
      !answer.hidden_at ||
      isAdmin ||
      isAuthor ||
      (viewer !== null && answer.user_id === viewer.uid)
  )
  const otherAnswerCount = answers.filter(
    (answer) => answer.user_id !== post.user_id
  ).length

  const [postMarkdown, ...answerMarkdowns] = await linkResourceCards(
    db,
    [post.content, ...visibleAnswers.map((answer) => answer.content)],
    visibilityWhere
  )
  const serialized: HelpAnswer[] = await Promise.all(
    visibleAnswers.map(async (answer, index) => {
      const own = viewer !== null && answer.user_id === viewer.uid
      return {
        id: answer.id,
        content: await markdownToHtml(answerMarkdowns[index]),
        ...(own ? { markdown: answer.content } : {}),
        user: toUser(answer.user),
        usefulCount: answer._count.votes,
        isUseful: voted.has(answer.id),
        isAccepted: post.accepted_answer_id === answer.id,
        hidden: answer.hidden_at !== null,
        canEdit: own,
        canDelete: own && post.accepted_answer_id !== answer.id,
        replies: repliesByAnswer.get(answer.id) ?? [],
        created: answer.created.toISOString(),
        updated: answer.updated.toISOString()
      }
    })
  )
  // Accepted first, then by 「有用」, then oldest first.
  serialized.sort(
    (left, right) =>
      Number(right.isAccepted) - Number(left.isAccepted) ||
      right.usefulCount - left.usefulCount ||
      left.created.localeCompare(right.created)
  )

  const resource =
    post.resource && post.resource.status === 0 && patch
      ? {
          id: post.resource.id,
          name: post.resource.name,
          section: post.resource.section,
          href: `/${patch.unique_id}?tab=resources&resourceSection=${post.resource.section}&resourceId=${post.resource.id}`
        }
      : null

  return {
    id: post.id,
    category: post.category as HelpCategory,
    title: post.title,
    content: await markdownToHtml(postMarkdown),
    ...(isAuthor ? { markdown: post.content } : {}),
    status: post.status as HelpStatus,
    user: toUser(post.user),
    patch: toPatch(patch),
    gameName: post.game_name,
    gameLinks: post.game_links,
    resource,
    acceptedAnswerId: post.accepted_answer_id,
    hidden: post.hidden_at !== null,
    followCount: post._count.follows,
    isFollowing: Boolean(following),
    isAuthor,
    canDelete: isAuthor && otherAnswerCount === 0,
    canAnswer: viewer !== null && post.hidden_at === null,
    answers: serialized,
    created: post.created.toISOString(),
    updated: post.updated.toISOString()
  }
}
