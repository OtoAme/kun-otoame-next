import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A small in-memory stand-in for the rows the help service touches. It keeps
 * the conditional-update semantics the service relies on (`updateMany`
 * returning a count) so reward-once and quota limits are asserted on results,
 * not on mocked calls.
 */
const state = vi.hoisted(() => ({
  posts: new Map<number, Record<string, any>>(),
  answers: new Map<number, Record<string, any>>(),
  users: new Map<number, { register_time: Date; balance: number }>(),
  quota: new Map<string, { post_count: number; reward_count: number }>(),
  follows: [] as Array<{ post_id: number; user_id: number }>,
  replies: new Map<number, Record<string, any>>(),
  ledger: new Map<string, { userId: number; amount: number }>(),
  messages: [] as Array<Record<string, unknown>>,
  nextId: 100
}))

const matches = (
  row: Record<string, any>,
  where: Record<string, any>
): boolean =>
  Object.entries(where).every(([key, value]) => {
    if (key === 'OR') {
      return (value as Record<string, any>[]).some((part) => matches(row, part))
    }
    if (key === 'NOT') return !matches(row, value)
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('lt' in value) return row[key] < value.lt
      if ('not' in value) return row[key] !== value.not
      if ('in' in value) return value.in.includes(row[key])
    }
    return row[key] === value
  })

vi.mock('~/prisma/index', () => {
  const quotaKey = (userId: number, day: string) => `${userId}:${day}`
  const tx: Record<string, any> = {
    $queryRaw: vi.fn(
      async (strings: TemplateStringsArray, ...values: any[]) => {
        const sql = (
          strings.join ? strings.join('?') : String(strings)
        ) as string
        const text =
          typeof strings === 'object' && 'sql' in strings
            ? (strings as any).sql
            : sql
        if (/FROM help_post/.test(text)) {
          const id = values[0] ?? (strings as any).values?.[0]
          return state.posts.has(id) ? [{ id }] : []
        }
        const id = values[0] ?? (strings as any).values?.[0]
        const user = state.users.get(id)
        return user ? [{ id, register_time: user.register_time }] : []
      }
    ),
    help_post: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.user_id_request_id) {
          const { user_id, request_id } = where.user_id_request_id
          return (
            [...state.posts.values()].find(
              (post) =>
                post.user_id === user_id && post.request_id === request_id
            ) ?? null
          )
        }
        return state.posts.get(where.id) ?? null
      }),
      create: vi.fn(async ({ data }: any) => {
        const id = state.nextId++
        const row = {
          id,
          status: 'open',
          accepted_answer_id: null,
          rewarded_answer_id: null,
          hidden_at: null,
          deleted_at: null,
          ...data
        }
        state.posts.set(id, row)
        return row
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = state.posts.get(where.id)!
        Object.assign(row, data)
        return row
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = state.posts.get(where.id)
        if (!row || !matches(row, where)) return { count: 0 }
        Object.assign(row, data)
        return { count: 1 }
      })
    },
    help_answer: {
      create: vi.fn(async ({ data }: any) => {
        const id = state.nextId++
        const row = { id, hidden_at: null, deleted_at: null, ...data }
        state.answers.set(id, row)
        return row
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const answer = state.answers.get(where.id)
        if (!answer) return null
        return { ...answer, post: state.posts.get(answer.post_id) }
      }),
      count: vi.fn(
        async ({ where }: any) =>
          [...state.answers.values()].filter((answer) => matches(answer, where))
            .length
      ),
      update: vi.fn(async ({ where, data }: any) => {
        const row = state.answers.get(where.id)!
        Object.assign(row, data)
        return row
      })
    },
    help_reply: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.user_id_request_id) {
          const { user_id, request_id } = where.user_id_request_id
          return (
            [...state.replies.values()].find(
              (reply) =>
                reply.user_id === user_id && reply.request_id === request_id
            ) ?? null
          )
        }
        return state.replies.get(where.id) ?? null
      }),
      count: vi.fn(
        async ({ where }: any) =>
          [...state.replies.values()].filter((reply) => matches(reply, where))
            .length
      ),
      create: vi.fn(async ({ data }: any) => {
        const id = state.nextId++
        const row = { id, hidden_at: null, deleted_at: null, ...data }
        state.replies.set(id, row)
        return row
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = state.replies.get(where.id)
        if (!row || !matches(row, where)) return { count: 0 }
        Object.assign(row, data)
        return { count: 1 }
      })
    },
    user_message: {
      findFirst: vi.fn(async ({ where }: any) => {
        const hits = state.messages.filter(
          (m: any) =>
            m.recipient_id === where.recipient_id &&
            (m.status ?? 0) === where.status &&
            m.type === where.type &&
            m.link === where.link
        )
        return (hits[hits.length - 1] as any) ?? null
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row: any = state.messages.find((m: any) => m.id === where.id)
        Object.assign(row, data)
        return row
      })
    },
    help_follow: {
      findMany: vi.fn(async ({ where }: any) =>
        state.follows.filter(
          (follow) =>
            follow.post_id === where.post_id &&
            !where.NOT.user_id.in.includes(follow.user_id)
        )
      )
    },
    help_daily_quota: {
      createMany: vi.fn(async ({ data }: any) => {
        const key = quotaKey(data[0].user_id, data[0].day)
        if (!state.quota.has(key)) {
          state.quota.set(key, { post_count: 0, reward_count: 0 })
        }
        return { count: 1 }
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = state.quota.get(quotaKey(where.user_id, where.day))!
        const field = Object.keys(data)[0] as 'post_count' | 'reward_count'
        if (row[field] >= where[field].lt) return { count: 0 }
        row[field] += 1
        return { count: 1 }
      })
    },
    patch: { findUnique: vi.fn(async () => ({ id: 7, status: 0 })) },
    patch_resource: { findUnique: vi.fn(async () => null) },
    user: {
      findUnique: vi.fn(async ({ where }: any) => {
        const user = state.users.get(where.id)
        return user ? { register_time: user.register_time } : null
      })
    }
  }
  tx.$transaction = vi.fn(async (operation: (client: unknown) => unknown) =>
    operation(tx)
  )
  return { prisma: tx }
})

vi.mock('~/app/api/moemoepoint/service', () => {
  class MoemoepointInsufficientError extends Error {}
  const balance = (userId: number) => {
    const user = state.users.get(userId)!
    return { total: user.balance, reserved: 0, available: user.balance }
  }
  const apply = (input: any, delta: number) => {
    if (state.ledger.has(input.idempotencyKey)) {
      return { balance: balance(input.userId), ledgerId: 1, applied: false }
    }
    const user = state.users.get(input.userId)!
    if (
      input.requiredAvailable !== undefined &&
      user.balance < input.requiredAvailable
    ) {
      throw new MoemoepointInsufficientError()
    }
    user.balance += delta
    state.ledger.set(input.idempotencyKey, {
      userId: input.userId,
      amount: delta
    })
    return { balance: balance(input.userId), ledgerId: 1, applied: true }
  }
  return {
    MoemoepointInsufficientError,
    getCurrentBalance: vi.fn(async (_tx: unknown, userId: number) =>
      balance(userId)
    ),
    spendMoemoepoint: vi.fn(async (_tx: unknown, input: any) =>
      apply(input, -input.amount)
    ),
    earnMoemoepoint: vi.fn(async (_tx: unknown, input: any) =>
      apply(input, input.amount)
    )
  }
})

vi.mock('~/app/api/utils/message', () => ({
  createMessage: vi.fn(async (data: Record<string, unknown>) => {
    state.messages.push({ id: state.messages.length + 1, status: 0, ...data })
  })
}))

import {
  acceptHelpAnswer,
  createHelpPost,
  deleteHelpAnswer,
  createHelpAnswer,
  createHelpReply,
  deleteHelpPost,
  deleteHelpReply,
  helpBodyImages,
  helpDayKey
} from '~/app/api/help/service'
import {
  HELP_ANSWER_REWARD,
  HELP_DAILY_POST_LIMIT,
  HELP_POST_FEE
} from '~/constants/help'

const now = new Date('2026-10-29T04:00:00.000Z')
const daysAgo = (days: number) => new Date(now.getTime() - days * 86400000)
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const ASKER = 1
const ANSWERER = 2
const OTHER = 3
const NEWCOMER = 4

const seedPost = (overrides: Record<string, unknown> = {}) => {
  const id = state.nextId++
  state.posts.set(id, {
    id,
    user_id: ASKER,
    title: '游戏启动后黑屏',
    status: 'open',
    accepted_answer_id: null,
    rewarded_answer_id: null,
    hidden_at: null,
    deleted_at: null,
    ...overrides
  })
  return id
}

const seedAnswer = (postId: number, userId: number | null, overrides = {}) => {
  const id = state.nextId++
  state.answers.set(id, {
    id,
    post_id: postId,
    user_id: userId,
    hidden_at: null,
    deleted_at: null,
    ...overrides
  })
  return id
}

const postInput = (n: number) => ({
  requestId: uuid(n),
  category: 'runtime' as const,
  title: '游戏启动后黑屏',
  content: '系统是 Windows 11，已经装了运行库',
  gameName: '',
  gameLinks: [] as string[],
  patchId: null,
  resourceId: null
})

beforeEach(() => {
  state.posts.clear()
  state.answers.clear()
  state.quota.clear()
  state.ledger.clear()
  state.follows.length = 0
  state.replies.clear()
  state.messages.length = 0
  state.nextId = 100
  state.users.clear()
  state.users.set(ASKER, { register_time: daysAgo(30), balance: 100 })
  state.users.set(ANSWERER, { register_time: daysAgo(30), balance: 20 })
  state.users.set(OTHER, { register_time: daysAgo(30), balance: 20 })
  state.users.set(NEWCOMER, { register_time: daysAgo(2), balance: 20 })
})

describe('help post fee and daily limit', () => {
  it('charges the fee once and replays the same request id', async () => {
    const first = await createHelpPost(postInput(1), ASKER, { now })
    const replay = await createHelpPost(postInput(1), ASKER, { now })

    expect(typeof first).toBe('object')
    expect(replay).toEqual({
      postId: (first as { postId: number }).postId,
      moemoepointBalance: { total: 95, reserved: 0, available: 95 }
    })
    expect(state.users.get(ASKER)!.balance).toBe(100 - HELP_POST_FEE)
    expect(state.posts.size).toBe(1)
  })

  it('refuses when the available balance is below the fee', async () => {
    state.users.get(ASKER)!.balance = HELP_POST_FEE - 1

    const result = await createHelpPost(postInput(1), ASKER, { now })

    expect(result).toContain('可用萌萌点不足')
    expect(state.users.get(ASKER)!.balance).toBe(HELP_POST_FEE - 1)
  })

  it('stops at the daily post limit', async () => {
    for (let n = 1; n <= HELP_DAILY_POST_LIMIT; n += 1) {
      expect(typeof (await createHelpPost(postInput(n), ASKER, { now }))).toBe(
        'object'
      )
    }

    const over = await createHelpPost(postInput(99), ASKER, { now })

    expect(over).toContain(`最多发布 ${HELP_DAILY_POST_LIMIT} 条`)
    expect(state.quota.get(`${ASKER}:${helpDayKey(now)}`)!.post_count).toBe(
      HELP_DAILY_POST_LIMIT
    )
  })

  it('uses the Shanghai natural day', () => {
    expect(helpDayKey(new Date('2026-10-28T15:59:59.999Z'))).toBe('2026-10-28')
    expect(helpDayKey(new Date('2026-10-28T16:00:00.000Z'))).toBe('2026-10-29')
  })
})

describe('accepting answers', () => {
  it('rewards the first qualifying acceptance once and never moves it', async () => {
    const postId = seedPost()
    const first = seedAnswer(postId, ANSWERER)
    const second = seedAnswer(postId, OTHER)

    const accepted = await acceptHelpAnswer(
      { postId, answerId: first },
      ASKER,
      { now }
    )
    const changed = await acceptHelpAnswer(
      { postId, answerId: second },
      ASKER,
      { now }
    )
    const cancelled = await acceptHelpAnswer(
      { postId, answerId: null },
      ASKER,
      { now }
    )

    expect(accepted).toEqual({
      status: 'solved',
      acceptedAnswerId: first,
      rewarded: true
    })
    expect(changed).toEqual({
      status: 'solved',
      acceptedAnswerId: second,
      rewarded: false
    })
    expect(cancelled).toEqual({
      status: 'open',
      acceptedAnswerId: null,
      rewarded: false
    })
    expect(state.users.get(ANSWERER)!.balance).toBe(20 + HELP_ANSWER_REWARD)
    expect(state.users.get(OTHER)!.balance).toBe(20)
    expect(state.posts.get(postId)!.rewarded_answer_id).toBe(first)
  })

  it('keeps the slot open after an unqualified acceptance', async () => {
    const postId = seedPost()
    const newcomer = seedAnswer(postId, NEWCOMER)
    const veteran = seedAnswer(postId, ANSWERER)

    const first = await acceptHelpAnswer(
      { postId, answerId: newcomer },
      ASKER,
      { now }
    )
    const second = await acceptHelpAnswer(
      { postId, answerId: veteran },
      ASKER,
      { now }
    )

    expect(first).toMatchObject({ rewarded: false })
    expect(second).toMatchObject({ rewarded: true })
    expect(state.users.get(NEWCOMER)!.balance).toBe(20)
    expect(state.users.get(ANSWERER)!.balance).toBe(20 + HELP_ANSWER_REWARD)
  })

  it('pays nothing when the asker is not yet eligible', async () => {
    state.users.get(ASKER)!.register_time = daysAgo(1)
    const postId = seedPost()
    const answer = seedAnswer(postId, ANSWERER)

    const result = await acceptHelpAnswer({ postId, answerId: answer }, ASKER, {
      now
    })

    expect(result).toMatchObject({ status: 'solved', rewarded: false })
    expect(state.posts.get(postId)!.rewarded_answer_id).toBeNull()
  })

  it('accepts an answer whose author deleted the account without paying', async () => {
    const postId = seedPost()
    const answer = seedAnswer(postId, null)

    const result = await acceptHelpAnswer({ postId, answerId: answer }, ASKER, {
      now
    })

    expect(result).toEqual({
      status: 'solved',
      acceptedAnswerId: answer,
      rewarded: false
    })
  })

  it('refuses own, hidden and foreign answers, and non-askers', async () => {
    const postId = seedPost()
    const own = seedAnswer(postId, ASKER)
    const hidden = seedAnswer(postId, ANSWERER, { hidden_at: now })
    const elsewhere = seedAnswer(seedPost(), ANSWERER)
    const fine = seedAnswer(postId, ANSWERER)

    expect(
      await acceptHelpAnswer({ postId, answerId: own }, ASKER, { now })
    ).toBe('不能采纳自己的回答')
    expect(
      await acceptHelpAnswer({ postId, answerId: hidden }, ASKER, { now })
    ).toBe('回答不存在或不能采纳')
    expect(
      await acceptHelpAnswer({ postId, answerId: elsewhere }, ASKER, { now })
    ).toBe('回答不存在或不能采纳')
    expect(
      await acceptHelpAnswer({ postId, answerId: fine }, OTHER, { now })
    ).toBe('只有提问者可以采纳回答')
    expect(state.posts.get(postId)!.status).toBe('open')
  })

  it('notifies followers once when the post becomes solved', async () => {
    const postId = seedPost()
    state.follows.push({ post_id: postId, user_id: OTHER })
    const first = seedAnswer(postId, ANSWERER)
    const second = seedAnswer(postId, NEWCOMER)

    await acceptHelpAnswer({ postId, answerId: first }, ASKER, { now })
    await acceptHelpAnswer({ postId, answerId: second }, ASKER, { now })

    expect(
      state.messages.filter((message) => message.recipient_id === OTHER)
    ).toHaveLength(1)
  })
})

describe('deleting', () => {
  it('lets the asker delete only while nobody else answered', async () => {
    const empty = seedPost()
    seedAnswer(empty, ASKER)
    const answered = seedPost()
    seedAnswer(answered, ANSWERER)
    const orphaned = seedPost()
    seedAnswer(orphaned, null)

    expect(await deleteHelpPost(empty, ASKER, { now })).toEqual({
      postId: empty
    })
    expect(await deleteHelpPost(answered, ASKER, { now })).toContain(
      '已有其他用户回答'
    )
    expect(await deleteHelpPost(orphaned, ASKER, { now })).toContain(
      '已有其他用户回答'
    )
    expect(await deleteHelpPost(answered, OTHER, { now })).toBe(
      '只能删除自己的求助'
    )
    expect(state.posts.get(empty)!.deleted_at).toEqual(now)
    expect(state.posts.get(answered)!.deleted_at).toBeNull()
  })

  it('keeps an accepted answer until acceptance moves', async () => {
    const postId = seedPost()
    const answer = seedAnswer(postId, ANSWERER)
    await acceptHelpAnswer({ postId, answerId: answer }, ASKER, { now })

    expect(await deleteHelpAnswer(answer, ANSWERER, { now })).toBe(
      '已被采纳的回答不能删除，可以编辑内容'
    )
    await acceptHelpAnswer({ postId, answerId: null }, ASKER, { now })
    expect(await deleteHelpAnswer(answer, ANSWERER, { now })).toEqual({
      answerId: answer
    })
  })
})

describe('replies under an answer', () => {
  const replyInput = (answerId: number, n: number, replyToUserId?: number) => ({
    answerId,
    requestId: uuid(500 + n),
    content: '更新了驱动还是黑屏',
    replyToUserId: replyToUserId ?? null
  })

  it('notifies the answer author once and replays the request id', async () => {
    const postId = seedPost()
    const answer = seedAnswer(postId, ANSWERER)

    const first = await createHelpReply(replyInput(answer, 1), ASKER, { now })
    const replay = await createHelpReply(replyInput(answer, 1), ASKER, { now })

    expect(replay).toEqual(first)
    expect(state.replies.size).toBe(1)
    expect(
      state.messages.filter((message) => message.recipient_id === ANSWERER)
    ).toHaveLength(1)
  })

  it('keeps a named target only when that user is in the thread', async () => {
    const postId = seedPost()
    const answer = seedAnswer(postId, ANSWERER)
    await createHelpReply(replyInput(answer, 1), ASKER, { now })

    await createHelpReply(replyInput(answer, 2, ASKER), OTHER, { now })
    await createHelpReply(replyInput(answer, 3, NEWCOMER), OTHER, { now })

    const [, toAsker, toOutsider] = [...state.replies.values()]
    expect(toAsker.reply_to_user_id).toBe(ASKER)
    expect(toOutsider.reply_to_user_id).toBeNull()
    expect(
      state.messages.filter((message) => message.recipient_id === NEWCOMER)
    ).toHaveLength(0)
  })

  it('refuses replies under a hidden answer or post', async () => {
    const hiddenPost = seedPost({ hidden_at: now })
    const onHiddenPost = seedAnswer(hiddenPost, ANSWERER)
    const postId = seedPost()
    const hiddenAnswer = seedAnswer(postId, ANSWERER, { hidden_at: now })

    expect(
      await createHelpReply(replyInput(onHiddenPost, 1), OTHER, { now })
    ).toBe('该内容已被隐藏，暂时不能回复')
    expect(
      await createHelpReply(replyInput(hiddenAnswer, 2), OTHER, { now })
    ).toBe('该内容已被隐藏，暂时不能回复')
    expect(state.replies.size).toBe(0)
  })

  it('lets only the author delete a reply', async () => {
    const postId = seedPost()
    const answer = seedAnswer(postId, ANSWERER)
    const created = await createHelpReply(replyInput(answer, 1), ASKER, { now })
    const replyId = (created as { replyId: number }).replyId

    expect(await deleteHelpReply(replyId, OTHER, { now })).toBe(
      '回复不存在或不能删除'
    )
    expect(await deleteHelpReply(replyId, ASKER, { now })).toEqual({ replyId })
    expect(state.replies.get(replyId)!.deleted_at).toEqual(now)
  })
})

describe('images in bodies', () => {
  it('finds markdown images in order', () => {
    expect(
      helpBodyImages(
        '开头 ![a](https://img.example/1.avif) 中间 ![](https://img.example/2.avif "t")'
      )
    ).toEqual(['https://img.example/1.avif', 'https://img.example/2.avif'])
  })

  it('refuses a post with more than six images, before charging', async () => {
    const content = Array.from(
      { length: 7 },
      (_, n) => `![](https://img.example/${n}.avif)`
    ).join('\n')

    const result = await createHelpPost({ ...postInput(1), content }, ASKER, {
      now
    })

    expect(result).toBe('每条内容最多 6 张图片')
    expect(state.users.get(ASKER)!.balance).toBe(100)
    expect(state.posts.size).toBe(0)
  })
})

describe('follower notices for new answers', () => {
  const answerInput = (postId: number, n: number) => ({
    postId,
    requestId: uuid(900 + n),
    content: '试试这个办法'
  })
  const noticesFor = (uid: number) =>
    state.messages.filter(
      (m: any) => m.recipient_id === uid && m.type === 'system'
    ) as any[]

  it('merges unread new-answer notices into one count', async () => {
    const postId = seedPost()
    state.follows.push({ post_id: postId, user_id: OTHER })

    await createHelpAnswer(answerInput(postId, 1), ANSWERER, { now })
    await createHelpAnswer(answerInput(postId, 2), NEWCOMER, { now })

    const notices = noticesFor(OTHER)
    expect(notices).toHaveLength(1)
    expect(notices[0].content).toBe(
      '您关注的求助「游戏启动后黑屏」有 2 条新回答'
    )
  })

  it('starts a new notice after the follower read the old one', async () => {
    const postId = seedPost()
    state.follows.push({ post_id: postId, user_id: OTHER })
    await createHelpAnswer(answerInput(postId, 1), ANSWERER, { now })
    noticesFor(OTHER)[0].status = 1

    await createHelpAnswer(answerInput(postId, 2), NEWCOMER, { now })

    expect(noticesFor(OTHER).map((m) => m.content)).toEqual([
      '您关注的求助「游戏启动后黑屏」有 1 条新回答',
      '您关注的求助「游戏启动后黑屏」有 1 条新回答'
    ])
  })

  it('does not notify a follower about their own answer', async () => {
    const postId = seedPost()
    state.follows.push({ post_id: postId, user_id: OTHER })

    await createHelpAnswer(answerInput(postId, 1), OTHER, { now })

    expect(noticesFor(OTHER)).toHaveLength(0)
  })
})
