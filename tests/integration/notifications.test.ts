import pg, { type Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { Prisma, PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { CreateMessageType } from '~/types/api/message'

const shared = vi.hoisted(() => ({ database: null as PrismaClient | null }))
vi.mock('~/prisma/index', () => ({
  get prisma() {
    return shared.database
  }
}))

import {
  aggregateNotificationBatch,
  createNotificationBatch
} from '~/app/api/utils/message'
import {
  clearReadMessage,
  getMessage,
  readMessage,
  readAllMessages
} from '~/app/api/message/service'
import {
  notificationCategorySql,
  readNotificationSummary
} from '~/app/api/message/notificationQuery'
import {
  prepareAccountPreferenceDeletion,
  readPreferenceSnapshot,
  saveAccountPreferences
} from '~/lib/accountPreferences/service'
import { acceptHelpAnswer, createHelpAnswer } from '~/app/api/help/service'
import { HELP_ANSWER_REWARD } from '~/constants/help'
import { handleFeedback } from '~/app/api/admin/feedback/service'

const databaseUrl = process.env.KUN_NOTIFICATIONS_TEST_DATABASE_URL
const nonce = process.env.KUN_NOTIFICATIONS_TEST_NONCE
const deferred = <Value>() => {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}
const sqlText = (query: Prisma.Sql | TemplateStringsArray) =>
  'sql' in query ? query.sql : query.join('?')
type Transaction = Prisma.TransactionClient
type Hooks = {
  start?: (transaction: Transaction, attempt: number) => Promise<void>
  query?: (sql: string, result: unknown, attempt: number) => Promise<void>
  finish?: (transaction: Transaction, attempt: number) => Promise<void>
  failed?: (error: unknown, attempt: number) => void
}
const instrument = (database: PrismaClient, hooks: Hooks) => {
  let attempts = 0
  const client = new Proxy(database, {
    get(target, property) {
      if (property !== '$transaction') return Reflect.get(target, property)
      return async (
        operation: (transaction: Transaction) => Promise<unknown>,
        options: object
      ) => {
        const attempt = ++attempts
        try {
          return await target.$transaction(async (transaction) => {
            await hooks.start?.(transaction, attempt)
            const observed = new Proxy(transaction, {
              get(client, method) {
                if (method !== '$queryRaw') return Reflect.get(client, method)
                return async (
                  query: Prisma.Sql | TemplateStringsArray,
                  ...values: unknown[]
                ) => {
                  const result = await client.$queryRaw(query, ...values)
                  await hooks.query?.(sqlText(query), result, attempt)
                  return result
                }
              }
            })
            const result = await operation(observed)
            await hooks.finish?.(transaction, attempt)
            return result
          }, options)
        } catch (error) {
          hooks.failed?.(error, attempt)
          throw error
        }
      }
    }
  })
  return { client, attempts: () => attempts }
}

describe.skipIf(!databaseUrl)(
  'notifications on explicitly identified disposable PostgreSQL',
  () => {
    let database: PrismaClient
    let pool: Pool
    let accountNumber = 0
    const evidence: Record<string, unknown> = {}
    const account = () =>
      database.user.create({
        data: {
          name: `notification_${++accountNumber}`,
          email: `notification_${nonce}_${accountNumber}@example.test`,
          password: 'synthetic',
          enable_email_notice: false,
          register_time: new Date('2025-01-01'),
          moemoepoint: 100
        }
      })
    const notice = (
      uid: number,
      changes: Partial<CreateMessageType> = {}
    ): CreateMessageType => ({
      recipient_id: uid,
      type: 'system',
      event_type: 'site-announcement',
      content: '合成通知',
      link: '/help/1',
      ...changes
    })
    const aggregate = (
      uid: number,
      changes: Partial<CreateMessageType> = {},
      client = database
    ) =>
      client.$transaction((transaction) =>
        aggregateNotificationBatch(
          [
            notice(uid, {
              event_type: 'help-follow-answer',
              link: '/help/1',
              ...changes
            })
          ],
          (_input, count) => `合成聚合 ${count}`,
          transaction
        )
      )
    const summary = (uid: number) => readNotificationSummary(database, uid)
    const pid = async (transaction: Transaction) =>
      (
        await transaction.$queryRaw<
          { pid: number }[]
        >`SELECT pg_backend_pid() AS pid`
      )[0].pid
    const blockedBy = async (waiting: number, blocking: number) => {
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        const result = await pool.query<{ blockers: number[] }>(
          'SELECT pg_blocking_pids($1) AS blockers',
          [waiting]
        )
        if (result.rows[0].blockers.includes(blocking))
          return result.rows[0].blockers
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      throw new Error(
        `Expected isolated backend ${waiting} to wait on ${blocking}`
      )
    }

    beforeAll(async () => {
      const target = new URL(databaseUrl!)
      if (
        target.hostname !== '127.0.0.1' ||
        !target.port ||
        target.port === '5432' ||
        !nonce ||
        target.pathname !== `/notifications_${nonce}_business` ||
        process.env.KUN_DATABASE_URL !== databaseUrl
      )
        throw new Error(
          'An explicit disposable notification database is required'
        )
      pool = new pg.Pool({ connectionString: databaseUrl, max: 12 })
      const identity = await pool.query(
        'SELECT current_database() AS name,current_user AS role,nonce FROM acceptance_identity'
      )
      expect(identity.rows).toEqual([
        { name: target.pathname.slice(1), role: 'postgres', nonce }
      ])
      database = new PrismaClient({ adapter: new PrismaPg(pool) })
      shared.database = database
      evidence.identity = identity.rows[0]
    })
    afterAll(async () => {
      shared.database = null
      if (nonce)
        await writeFile(
          `.local/notification-center/postgres-${nonce}/business-evidence.json`,
          JSON.stringify(evidence, null, 2),
          { mode: 0o600 }
        )
      await database?.$disconnect()
      await pool?.end()
    })

    it('uses recipient and cursor indexes without sorting large notification collections', async () => {
      const owner = await account()
      const other = await account()
      await database.$executeRaw`INSERT INTO user_message (type,content,link,status,recipient_id,event_type,created,updated)
      SELECT 'system','合成索引样本','/help/1',series % 2,
        CASE WHEN series <= 40000 THEN ${owner.id}::int ELSE ${other.id}::int END,
        CASE WHEN series % 5 = 0 THEN 'help-follow-answer' ELSE 'site-announcement' END,now(),now()
      FROM generate_series(1,80000) AS series`
      await database.$executeRaw`ANALYZE user_message`
      const plans: Record<string, unknown> = {}
      for (const state of ['all', 'unread'] as const) {
        for (const category of [undefined, 'help'] as const) {
          const name = `${state}-${category ?? 'all'}`
          const plan = await database.$queryRaw<
            Record<'QUERY PLAN', Prisma.JsonValue>[]
          >(Prisma.sql`
          EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM user_message
          WHERE recipient_id=${owner.id} AND id <= 40000
          ${state === 'unread' ? Prisma.sql`AND status=0` : Prisma.empty}
          ${category ? Prisma.sql`AND (${notificationCategorySql})=${category}` : Prisma.empty}
          ORDER BY id DESC LIMIT 31`)
          plans[name] = plan[0]['QUERY PLAN']
        }
      }
      evidence.indexPlans = plans
      const encoded = JSON.stringify(plans)
      expect(encoded).not.toContain('"Node Type":"Sort"')
      expect(encoded).toContain('user_message_recipient_id_id_idx')
      expect(encoded).toContain('user_message_recipient_id_status_id_idx')
    })

    it('claims only unaddressed legacy feedback once under real concurrent handling', async () => {
      const author = await account()
      const administrator = await account()
      const record = await database.user_message.create({
        data: {
          type: 'feedback',
          sender_id: author.id,
          content: '合成反馈正文',
          link: '/legacy-feedback'
        }
      })
      const bothRead = deferred<void>()
      let readers = 0
      const racing = database.$extends({
        query: {
          user_message: {
            async findUnique({ args, query }) {
              const result = await query(args)
              if (args.where.id === record.id && result?.status === 0) {
                if (++readers === 2) bothRead.resolve()
                await bothRead.promise
              }
              return result
            }
          }
        }
      })
      shared.database = racing as unknown as PrismaClient
      let results: unknown[]
      try {
        results = await Promise.all([
          handleFeedback(
            { messageId: record.id, content: '第一次合成处理' },
            administrator.id
          ),
          handleFeedback(
            { messageId: record.id, content: '第二次合成处理' },
            administrator.id
          )
        ])
      } finally {
        shared.database = database
      }
      expect(readers).toBe(2)
      expect(
        results.filter((result) => typeof result === 'object')
      ).toHaveLength(1)
      expect(
        results.filter((result) => result === '该反馈已被处理')
      ).toHaveLength(1)
      expect(
        await database.user_message.count({
          where: { recipient_id: author.id, event_type: 'feedback-result' }
        })
      ).toBe(1)
      const foreignRecords = await createNotificationBatch(
        [
          notice(author.id, { content: '普通站务通知' }),
          notice(author.id, {
            type: 'feedback',
            event_type: 'help-resource',
            content: '有收件人的普通通知'
          })
        ],
        database
      )
      const before = await summary(author.id)
      for (const result of foreignRecords)
        expect(
          await handleFeedback(
            { messageId: result.message!.id, content: '不得确认' },
            administrator.id
          )
        ).toBe('未找到该反馈')
      expect(
        await handleFeedback(
          { messageId: 2147483647, content: '不存在' },
          administrator.id
        )
      ).toBe('未找到该反馈')
      expect(await summary(author.id)).toEqual(before)
      expect(
        await database.user_message.count({
          where: {
            id: { in: foreignRecords.map((result) => result.message!.id) },
            status: 0
          }
        })
      ).toBe(2)
      expect(
        await database.user_message.findUniqueOrThrow({
          where: { id: record.id }
        })
      ).toMatchObject({ status: 1, recipient_id: null, type: 'feedback' })
      evidence.feedbackClaims = {
        simultaneousReads: readers,
        processed: 1,
        resultNotices: 1,
        foreignNotificationsUnchanged: 2,
        sequenceUnchangedOnRejection: before.sequence
      }
    })

    it('uses the existing global and item versions for subscription conflicts and independent saves', async () => {
      const user = await account()
      const initial = await readPreferenceSnapshot(
        database,
        user.id,
        'synthetic-context'
      )
      expect(initial.items['notification:like']).toEqual({
        value: true,
        version: 0
      })

      const first = await saveAccountPreferences(
        database,
        user.id,
        'synthetic-context',
        [{ key: 'notification:like', value: false, version: 0 }]
      )
      expect(first).toMatchObject({
        version: 1,
        items: { 'notification:like': { value: false, version: 1 } }
      })
      const conflict = await saveAccountPreferences(
        database,
        user.id,
        'synthetic-context',
        [{ key: 'notification:like', value: true, version: 0 }]
      )
      expect(conflict).toMatchObject({
        code: 'PREFERENCE_CONFLICT',
        conflicts: ['notification:like']
      })
      await Promise.all([
        saveAccountPreferences(database, user.id, 'synthetic-context', [
          { key: 'notification:mention', value: false, version: 0 }
        ]),
        saveAccountPreferences(database, user.id, 'synthetic-context', [
          { key: 'email-notice', value: true, version: 0 }
        ])
      ])
      expect(
        await readPreferenceSnapshot(database, user.id, 'synthetic-context')
      ).toMatchObject({
        version: 3,
        items: {
          'notification:mention': { value: false, version: 1 },
          'email-notice': { value: true, version: 1 }
        }
      })
      expect(
        await database.account_preference_version.count({
          where: { user_id: user.id }
        })
      ).toBe(3)
      expect(
        await database.notification_content_sequence.count({
          where: { user_id: user.id }
        })
      ).toBe(0)
    })

    it('keeps ninety unread after loading thirty and confirms only six then thirty visible versions', async () => {
      const user = await account()
      const created = await createNotificationBatch(
        Array.from({ length: 90 }, (_, index) =>
          notice(user.id, { content: `合成通知 ${index + 1}` })
        ),
        database
      )
      const ids = created
        .map((result) => result.message!.id)
        .sort((first, second) => second - first)
      const first = await getMessage(
        { state: 'unread', page: 1, limit: 30 },
        user.id
      )
      expect(first.messages.map((message) => message.id)).toEqual(
        ids.slice(0, 30)
      )
      expect(first.total).toBe(90)
      expect(await summary(user.id)).toMatchObject({
        unread: 90,
        sequence: '90',
        categories: { account: { unread: 90, sequence: '90' } }
      })
      await readMessage(user.id, {
        items: first.messages.slice(0, 6).map((message) => ({
          id: message.id,
          version: message.contentVersion!
        }))
      })
      expect(await summary(user.id)).toMatchObject({
        unread: 84,
        sequence: '90'
      })
      await readMessage(user.id, {
        items: first.messages.map((message) => ({
          id: message.id,
          version: message.contentVersion!
        }))
      })
      expect(await summary(user.id)).toMatchObject({
        unread: 60,
        sequence: '90'
      })
      const second = await getMessage(
        {
          state: 'unread',
          page: 2,
          limit: 30,
          upperId: first.upperId,
          cursor: first.nextCursor!
        },
        user.id
      )
      const third = await getMessage(
        {
          state: 'unread',
          page: 3,
          limit: 30,
          upperId: first.upperId,
          cursor: second.nextCursor!
        },
        user.id
      )
      expect(
        [...first.messages, ...second.messages, ...third.messages].map(
          (message) => message.id
        )
      ).toEqual(ids)
      expect(third.nextCursor).toBeNull()
      expect(await clearReadMessage(user.id, '', 'help')).toMatchObject({
        deleted: 0
      })
      expect(await clearReadMessage(user.id, '', 'account')).toMatchObject({
        deleted: 30
      })
      expect(await summary(user.id)).toMatchObject({
        unread: 60,
        sequence: '90'
      })
      evidence.ninety = {
        initial: 90,
        loaded: 30,
        seenSix: 84,
        seenThirty: 60,
        uniqueIds: new Set(
          [...first.messages, ...second.messages, ...third.messages].map(
            (message) => message.id
          )
        ).size
      }
    })

    it('keeps old list content and sequence in one repeatable snapshot during an aggregation update', async () => {
      const user = await account()
      await aggregate(user.id)
      const captured = deferred<void>()
      const proceed = deferred<void>()
      const wrapped = instrument(database, {
        query: async (sql) => {
          if (
            sql.includes('jsonb_object_agg') &&
            sql.includes('notification_content_sequence')
          ) {
            captured.resolve()
            await proceed.promise
          }
        }
      })
      shared.database = wrapped.client
      const reading = getMessage(
        { state: 'unread', page: 1, limit: 30 },
        user.id
      )
      try {
        await captured.promise
        await aggregate(user.id)
        proceed.resolve()
        const old = await reading
        expect(old.contentSequence).toBe('1')
        expect(old.messages[0]).toMatchObject({
          content: '合成聚合 1',
          contentVersion: '1'
        })
      } finally {
        proceed.resolve()
        shared.database = database
      }
      expect(await summary(user.id)).toMatchObject({ unread: 1, sequence: '2' })
      evidence.snapshot = {
        oldSequence: '1',
        oldVersion: '1',
        currentSequence: '2',
        currentVersion: '2'
      }
    })

    it('does not clear newer aggregate content with an old seen version or increment on reading and clearing', async () => {
      const user = await account()
      await aggregate(user.id)
      const first = await database.user_message.findFirstOrThrow({
        where: { recipient_id: user.id }
      })
      await aggregate(user.id)
      expect(
        await readMessage(user.id, { items: [{ id: first.id, version: '1' }] })
      ).toMatchObject({
        results: [{ id: first.id, outcome: 'changed' }],
        summary: { notifications: { unread: 1, sequence: '2' } }
      })
      await readMessage(user.id, { items: [{ id: first.id, version: '2' }] })
      await clearReadMessage(user.id, '', 'help')
      expect(await summary(user.id)).toMatchObject({ unread: 0, sequence: '2' })
      await aggregate(user.id)
      const next = await database.user_message.findFirstOrThrow({
        where: { recipient_id: user.id }
      })
      expect(next.id).not.toBe(first.id)
      expect(next.content_version).toBe(1n)
      expect(await summary(user.id)).toMatchObject({ unread: 1, sequence: '3' })
    })

    it.each([
      { cleanup: false, bulk: false },
      { cleanup: true, bulk: false },
      { cleanup: false, bulk: true }
    ])(
      'creates a new dynamic when reading wins the aggregate candidate race, cleanup=$cleanup, bulk=$bulk',
      async ({ cleanup, bulk }) => {
        const user = await account()
        await aggregate(user.id)
        const first = await database.user_message.findFirstOrThrow({
          where: { recipient_id: user.id }
        })
        const captured = deferred<void>()
        const proceed = deferred<void>()
        let intercepted = false
        const racing = database.$extends({
          query: {
            user_message: {
              async findFirst({ args, query }) {
                const result = await query(args)
                if (!intercepted) {
                  intercepted = true
                  captured.resolve()
                  await proceed.promise
                }
                return result
              }
            }
          }
        }) as unknown as PrismaClient
        const writing = aggregate(user.id, {}, racing)
        await captured.promise
        try {
          if (bulk) await readAllMessages(user.id, { scope: 'help' })
          else
            await readMessage(user.id, {
              items: [{ id: first.id, version: '1' }]
            })
          if (cleanup) await clearReadMessage(user.id, '', 'help')
        } finally {
          proceed.resolve()
        }
        await writing
        const rows = await database.user_message.findMany({
          where: { recipient_id: user.id },
          orderBy: { id: 'asc' }
        })
        expect(rows).toHaveLength(cleanup ? 1 : 2)
        expect(rows.at(-1)).toMatchObject({
          status: 0,
          aggregate_count: 1,
          content_version: 1n
        })
        expect(rows.at(-1)!.id).not.toBe(first.id)
        expect(await summary(user.id)).toMatchObject({
          unread: 1,
          sequence: '2'
        })
      }
    )

    it('marks an entire category across pages without modifying another recipient, private chat, content versions or timestamps', async () => {
      const owner = await account()
      const other = await account()
      await createNotificationBatch(
        [
          ...Array.from({ length: 45 }, (_, index) =>
            notice(owner.id, {
              event_type: 'help-follow-answer',
              content: `跨页合成通知 ${index}`
            })
          ),
          notice(owner.id),
          notice(other.id, { event_type: 'help-follow-answer' })
        ],
        database
      )
      const conversation = await database.user_conversation.create({
        data: {
          user_a_id: owner.id,
          user_b_id: other.id,
          user_a_unread_count: 3
        }
      })
      const before = await database.user_message.findMany({
        where: { recipient_id: owner.id },
        orderBy: { id: 'asc' }
      })
      const beforeSummary = await summary(owner.id)
      expect(await readAllMessages(owner.id, { scope: 'help' })).toMatchObject({
        read: 45,
        summary: { hasUnreadNotification: true, hasUnreadConversation: true }
      })
      const after = await database.user_message.findMany({
        where: { recipient_id: owner.id },
        orderBy: { id: 'asc' }
      })
      expect(after.map(({ status, ...message }) => message)).toEqual(
        before.map(({ status, ...message }) => message)
      )
      expect(after.filter((message) => message.status === 1)).toHaveLength(45)
      expect(await summary(owner.id)).toMatchObject({
        unread: 1,
        sequence: beforeSummary.sequence
      })
      expect(await summary(other.id)).toMatchObject({ unread: 1 })
      expect(
        await database.user_conversation.findUnique({
          where: { id: conversation.id }
        })
      ).toMatchObject({ user_a_unread_count: 3 })
      expect(await readAllMessages(owner.id, { scope: 'all' })).toMatchObject({
        read: 1
      })
      expect(await readAllMessages(owner.id, { scope: 'all' })).toMatchObject({
        read: 0
      })
    })

    it('keeps notifications inserted after the bulk selection unread and rolls back a failed bulk transaction', async () => {
      const owner = await account()
      await createNotificationBatch(
        [notice(owner.id), notice(owner.id, { content: '第二条合成通知' })],
        database
      )
      const selected = deferred<void>()
      const proceed = deferred<void>()
      const wrapped = instrument(database, {
        query: async (sql) => {
          if (sql.includes('FROM user_message') && sql.includes('FOR UPDATE')) {
            selected.resolve()
            await proceed.promise
          }
        }
      })
      shared.database = wrapped.client
      const reading = readAllMessages(owner.id, { scope: 'all' })
      try {
        await selected.promise
        await createNotificationBatch(
          [notice(owner.id, { content: '范围确认后的新通知' })],
          database
        )
        proceed.resolve()
        expect(await reading).toMatchObject({
          read: 2,
          summary: { notifications: { unread: 1 } }
        })
      } finally {
        proceed.resolve()
        shared.database = database
      }
      const failing = instrument(database, {
        finish: async () => {
          throw new Error('synthetic bulk failure')
        }
      })
      shared.database = failing.client
      try {
        await expect(
          readAllMessages(owner.id, { scope: 'all' })
        ).rejects.toThrow('synthetic bulk failure')
      } finally {
        shared.database = database
      }
      expect(await summary(owner.id)).toMatchObject({
        unread: 1,
        sequence: '3'
      })
    })

    it('rolls back content and counters together and counts only a successful deduplicated retry', async () => {
      const user = await account()
      await expect(
        database.$transaction(async (transaction) => {
          await createNotificationBatch([notice(user.id)], transaction)
          throw new Error('synthetic rollback')
        })
      ).rejects.toThrow('synthetic rollback')
      expect(await summary(user.id)).toMatchObject({ unread: 0, sequence: '0' })
      await createNotificationBatch([notice(user.id)], database, true)
      const retry = await createNotificationBatch(
        [notice(user.id)],
        database,
        true
      )
      expect(retry[0].outcome).toBe('duplicate')
      expect(await summary(user.id)).toMatchObject({ unread: 1, sequence: '1' })
    })

    it('preserves the help target lock, aggregates parallel answers, and rewards an accepted follower exactly once', async () => {
      const asker = await account()
      const answerer = await account()
      const another = await account()
      const follower = await account()
      const post = await database.help_post.create({
        data: {
          user_id: asker.id,
          request_id: randomUUID(),
          category: 'other',
          title: '合成并行求助',
          content: '合成求助正文'
        }
      })
      await database.help_follow.createMany({
        data: [answerer.id, follower.id, asker.id].map((user_id) => ({
          user_id,
          post_id: post.id
        }))
      })
      const input = {
        postId: post.id,
        content: '合成回答',
        requestId: randomUUID()
      }
      const answers = await Promise.all([
        createHelpAnswer(input, answerer.id, { db: database }),
        createHelpAnswer({ ...input, requestId: randomUUID() }, another.id, {
          db: database
        })
      ])
      expect(answers.every((result) => typeof result === 'object')).toBe(true)
      const combined = await database.user_message.findMany({
        where: { recipient_id: follower.id, event_type: 'help-follow-answer' }
      })
      expect(combined).toHaveLength(1)
      expect(combined[0]).toMatchObject({
        aggregate_count: 2,
        content_version: 2n
      })
      await createHelpAnswer(input, answerer.id, { db: database })
      expect(
        await database.help_answer.count({ where: { post_id: post.id } })
      ).toBe(2)
      expect(await summary(follower.id)).toMatchObject({
        unread: 1,
        sequence: '2'
      })
      await saveAccountPreferences(database, answerer.id, 'synthetic-context', [
        { key: 'notification:help-follow-resolved', value: false, version: 0 }
      ])
      const answer = await database.help_answer.findUniqueOrThrow({
        where: {
          user_id_request_id: {
            user_id: answerer.id,
            request_id: input.requestId
          }
        }
      })
      const accepted = await Promise.all([
        acceptHelpAnswer({ postId: post.id, answerId: answer.id }, asker.id, {
          db: database
        }),
        acceptHelpAnswer({ postId: post.id, answerId: answer.id }, asker.id, {
          db: database
        })
      ])
      expect(
        accepted.filter(
          (result) => typeof result === 'object' && result.rewarded
        )
      ).toHaveLength(1)
      expect(
        (await database.user.findUniqueOrThrow({ where: { id: answerer.id } }))
          .moemoepoint
      ).toBe(100 + HELP_ANSWER_REWARD)
      expect(
        await database.user_moemoepoint_ledger.count({
          where: { idempotency_key: `help:${post.id}:answer-reward` }
        })
      ).toBe(1)
      expect(
        await database.user_message.count({
          where: { recipient_id: answerer.id, event_type: 'help-accepted' }
        })
      ).toBe(1)
      expect(
        await database.user_message.count({
          where: {
            recipient_id: answerer.id,
            event_type: 'help-follow-resolved'
          }
        })
      ).toBe(0)
      evidence.parallelHelp = {
        answers: 2,
        aggregateVersion: '2',
        aggregateCount: 2,
        rewardLedgerEntries: 1,
        requiredAcceptanceNotices: 1
      }
    })

    it.each(['preference-first', 'notification-first'])(
      'serializes optional delivery with subscription closure in %s order',
      async (order) => {
        const user = await account()
        const locked = deferred<void>()
        const proceed = deferred<void>()
        const preferencePid = deferred<number>()
        const notificationPid = deferred<number>()
        const preferences = instrument(database, {
          start: async (transaction) =>
            preferencePid.resolve(await pid(transaction)),
          finish: async () => {
            if (order === 'preference-first') {
              locked.resolve()
              await proceed.promise
            }
          }
        })
        const notifications = instrument(database, {
          start: async (transaction) =>
            notificationPid.resolve(await pid(transaction)),
          finish: async () => {
            if (order === 'notification-first') {
              locked.resolve()
              await proceed.promise
            }
          }
        })
        const close = () =>
          saveAccountPreferences(
            preferences.client,
            user.id,
            'synthetic-context',
            [
              {
                key: 'notification:site-announcement',
                value: false,
                version: 0
              }
            ]
          )
        const send = () =>
          createNotificationBatch([notice(user.id)], notifications.client)
        const first = order === 'preference-first' ? close() : send()
        await locked.promise
        const second = order === 'preference-first' ? send() : close()
        let blockers: number[]
        try {
          const preference = await preferencePid.promise
          const notification = await notificationPid.promise
          blockers = await blockedBy(
            order === 'preference-first' ? notification : preference,
            order === 'preference-first' ? preference : notification
          )
        } finally {
          proceed.resolve()
        }
        await Promise.all([first, second])
        expect(await summary(user.id)).toMatchObject({
          unread: order === 'preference-first' ? 0 : 1,
          sequence: order === 'preference-first' ? '0' : '1'
        })
        expect(
          await readPreferenceSnapshot(database, user.id, 'synthetic-context')
        ).toMatchObject({
          version: 1,
          items: {
            'notification:site-announcement': { value: false, version: 1 }
          }
        })
        evidence[order] = {
          blockers,
          notificationSequence: order === 'preference-first' ? '0' : '1',
          preferenceVersion: 1
        }
      },
      20000
    )

    it.each(['deletion-first', 'notification-first'])(
      'keeps user deletion and notification foreign keys atomic in %s order',
      async (order) => {
        const user = await account()
        const locked = deferred<void>()
        const proceed = deferred<void>()
        const deletionPid = deferred<number>()
        const notificationPid = deferred<number>()
        const deleting = instrument(database, {
          start: async (transaction) =>
            deletionPid.resolve(await pid(transaction)),
          finish: async () => {
            if (order === 'deletion-first') {
              locked.resolve()
              await proceed.promise
            }
          }
        })
        const notifying = instrument(database, {
          start: async (transaction) =>
            notificationPid.resolve(await pid(transaction)),
          finish: async () => {
            if (order === 'notification-first') {
              locked.resolve()
              await proceed.promise
            }
          }
        })
        const remove = () =>
          deleting.client.$transaction(async (transaction) => {
            await prepareAccountPreferenceDeletion(transaction, user.id)
            await transaction.user.delete({ where: { id: user.id } })
          })
        const send = () =>
          createNotificationBatch([notice(user.id)], notifying.client)
        const first = order === 'deletion-first' ? remove() : send()
        await locked.promise
        const second = order === 'deletion-first' ? send() : remove()
        try {
          const deletion = await deletionPid.promise
          const notification = await notificationPid.promise
          await blockedBy(
            order === 'deletion-first' ? notification : deletion,
            order === 'deletion-first' ? deletion : notification
          )
        } finally {
          proceed.resolve()
        }
        await Promise.all([first, second])
        expect(
          await database.user.findUnique({ where: { id: user.id } })
        ).toBeNull()
        expect(
          await database.user_message.count({
            where: { recipient_id: user.id }
          })
        ).toBe(0)
        expect(
          await database.notification_content_sequence.count({
            where: { user_id: user.id }
          })
        ).toBe(0)
        expect(
          await database.notification_subscription.count({
            where: { user_id: user.id }
          })
        ).toBe(0)
        evidence[`deletion-${order}`] = {
          noAccount: true,
          noRecipientRows: true,
          noSequenceRows: true
        }
      },
      20000
    )

    it.each(['help', 'deletion'])(
      'records the actual %s deadlock victim and retries only the help database callback',
      async (victim) => {
        const asker = await account()
        const answerer = await account()
        const follower = await account()
        const post = await database.help_post.create({
          data: {
            user_id: asker.id,
            request_id: randomUUID(),
            category: 'other',
            title: '合成注销锁竞争',
            content: '合成求助正文'
          }
        })
        await database.help_follow.create({
          data: { user_id: follower.id, post_id: post.id }
        })
        const postLocked = deferred<void>()
        const proceed = deferred<void>()
        const businessPid = deferred<number>()
        const deletionPid = deferred<number>()
        const errors: string[] = []
        const business = instrument(database, {
          start: async (transaction, attempt) => {
            await transaction.$executeRawUnsafe(
              `SET LOCAL deadlock_timeout = '${victim === 'help' ? '200ms' : '3s'}'`
            )
            if (attempt === 1) businessPid.resolve(await pid(transaction))
          },
          query: async (sql, _result, attempt) => {
            if (
              attempt === 1 &&
              sql.includes('FROM help_post') &&
              sql.includes('FOR UPDATE')
            ) {
              postLocked.resolve()
              await proceed.promise
            }
          },
          failed: (error) => {
            errors.push(String(error))
          }
        })
        const request = {
          postId: post.id,
          content: '合成死锁回答',
          requestId: randomUUID()
        }
        const writing = createHelpAnswer(request, answerer.id, {
          db: business.client
        })
        await postLocked.promise
        const deleting = database.$transaction(async (transaction) => {
          await transaction.$executeRawUnsafe(
            `SET LOCAL deadlock_timeout = '${victim === 'deletion' ? '200ms' : '3s'}'`
          )
          await prepareAccountPreferenceDeletion(transaction, asker.id)
          deletionPid.resolve(await pid(transaction))
          await transaction.user.delete({ where: { id: asker.id } })
        })
        try {
          await blockedBy(await deletionPid.promise, await businessPid.promise)
        } finally {
          proceed.resolve()
        }
        const [written, removed] = await Promise.allSettled([writing, deleting])
        expect(written.status).toBe('fulfilled')
        if (victim === 'help') {
          expect(removed.status).toBe('fulfilled')
          expect(business.attempts()).toBe(2)
          expect(errors).toHaveLength(1)
          expect(errors[0]).toMatch(/40P01|P2034|deadlock/i)
        } else {
          expect(removed.status).toBe('rejected')
          expect(
            String(removed.status === 'rejected' ? removed.reason : '')
          ).toMatch(/40P01|P2034|deadlock/i)
          expect(business.attempts()).toBe(1)
          expect(errors).toHaveLength(0)
          await database.$transaction(async (transaction) => {
            await prepareAccountPreferenceDeletion(transaction, asker.id)
            await transaction.user.delete({ where: { id: asker.id } })
          })
        }
        expect(
          await database.help_answer.count({
            where: { post_id: post.id, request_id: request.requestId }
          })
        ).toBe(1)
        expect(await summary(follower.id)).toMatchObject({
          unread: 1,
          sequence: '1'
        })
        const content = await database.user_message.findFirstOrThrow({
          where: { recipient_id: follower.id }
        })
        expect(content).toMatchObject({
          aggregate_count: 1,
          content_version: 1n
        })
        evidence[`deadlock-${victim}`] = {
          victim,
          callbackAttempts: business.attempts(),
          insertedAnswers: 1,
          aggregateVersion: '1',
          contentSequence: '1',
          deletionRecovered: true
        }
      },
      20000
    )
  }
)
