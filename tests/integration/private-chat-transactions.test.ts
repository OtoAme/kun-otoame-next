import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import pg, { type Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, type Prisma } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ConversationMessagesResponse } from '~/types/api/conversation'

const state = vi.hoisted(() => ({
  client: undefined as PrismaClient | undefined,
  gate: undefined as (() => Promise<void>) | undefined,
  failUpdate: false
}))
vi.mock('~/prisma/index', () => ({
  prisma: new Proxy(
    {},
    {
      get: (_target, property) => {
        const client = state.client!
        if (property !== '$transaction')
          return Reflect.get(client, property, client)
        return (
          callback: (transaction: Prisma.TransactionClient) => Promise<unknown>
        ) =>
          client.$transaction(
            async (transaction) => {
              const gate = state.gate
              state.gate = undefined
              const wrapped = new Proxy(transaction, {
                get: (target, key) => {
                  if (key === '$queryRaw')
                    return async (...args: unknown[]) => {
                      const result = await Reflect.apply(
                        target.$queryRaw,
                        target,
                        args
                      )
                      if (gate) await gate()
                      return result
                    }
                  if (key === 'user_conversation' && state.failUpdate)
                    return new Proxy(target.user_conversation, {
                      get: (delegate, operation) =>
                        operation === 'update'
                          ? () => {
                              throw new Error('Synthetic rollback')
                            }
                          : Reflect.get(delegate, operation)
                    })
                  return Reflect.get(target, key)
                }
              })
              return callback(wrapped)
            },
            { timeout: 15_000 }
          )
      }
    }
  )
}))
vi.mock('~/app/api/message/conversation/rateLimit', () => ({
  checkConversationActionRateLimit: async () => ({ allowed: true })
}))
vi.mock('~/app/api/message/conversation/imageUploadMetadata', () => ({
  consumeConversationImageUploads: vi.fn(),
  restoreConversationImageUploads: vi.fn()
}))
vi.mock('~/lib/redis', () => ({
  redis: { eval: async () => JSON.stringify({ allowed: true, remaining: 30 }) },
  getPrefixedRedisKey: (key: string) => key,
  runRedisCommand: (command: () => unknown) => command()
}))
vi.mock('~/lib/s3', () => ({ deleteFileFromS3: vi.fn() }))
vi.mock('~/app/api/message/stickers/service', () => ({
  mapSticker: () => null,
  getStickerForSending: vi.fn()
}))

const databaseUrl = process.env.KUN_PRIVATE_CHAT_TEST_DATABASE_URL
const expectedDatabase = process.env.KUN_PRIVATE_CHAT_TEST_DATABASE_NAME
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe.skipIf(!databaseUrl)(
  'private chat real PostgreSQL service transactions',
  () => {
    let pool: Pool
    let client: PrismaClient
    let service: typeof import('~/app/api/message/conversation/[id]/service')
    let userIds: number[]
    let conversationId: number
    let otherConversationId: number

    const row = () =>
      client.user_conversation.findUniqueOrThrow({
        where: { id: conversationId }
      })
    const reset = async () => {
      state.failUpdate = false
      state.gate = undefined
      await client.user_private_message.deleteMany({
        where: { conversation_id: conversationId }
      })
      await client.user_conversation.update({
        where: { id: conversationId },
        data: {
          user_a_unread_count: 0,
          user_b_unread_count: 7,
          user_a_hidden: false,
          user_b_hidden: false,
          last_message_id: null
        }
      })
    }
    const send = (content = 'Synthetic private chat') =>
      service.sendMessage(conversationId, { type: 0, content }, userIds[1])
    const confirm = () =>
      service.markConversationAsRead(conversationId, userIds[0])
    const waitBlocked = async () => {
      const deadline = Date.now() + 3000
      while (Date.now() < deadline) {
        const result = await pool.query(
          "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'"
        )
        if (Number(result.rows[0].count) > 0) return
        await new Promise((done) => setTimeout(done, 10))
      }
      throw new Error(
        'The competing service did not wait for the conversation row lock'
      )
    }
    const interleave = async (
      first: () => Promise<unknown>,
      second: () => Promise<unknown>
    ) => {
      const acquired = deferred()
      const release = deferred()
      state.gate = async () => {
        acquired.resolve()
        await release.promise
      }
      const firstResult = first()
      await acquired.promise
      const secondResult = second()
      try {
        await waitBlocked()
      } finally {
        release.resolve()
      }
      return Promise.all([firstResult, secondResult])
    }

    beforeAll(async () => {
      if (
        !databaseUrl ||
        !expectedDatabase ||
        !/^private_chat_[a-z0-9_]+_e2e$/.test(expectedDatabase)
      )
        throw new Error('Explicit disposable database identity is required')
      const target = new URL(databaseUrl)
      if (
        target.hostname !== '127.0.0.1' ||
        !target.port ||
        target.port === '5432' ||
        target.pathname !== `/${expectedDatabase}`
      )
        throw new Error('Only a dedicated loopback database is allowed')
      pool = new pg.Pool({ connectionString: databaseUrl, max: 8 })
      const identity = await pool.query(
        'SELECT current_database() AS database, current_user AS role, inet_server_port() AS port'
      )
      expect(identity.rows[0]).toMatchObject({
        database: expectedDatabase,
        role: 'private_chat_test',
        port: 5432
      })
      const existing = await pool.query(
        'SELECT count(*)::int AS count FROM "user"'
      )
      expect(existing.rows[0].count).toBe(0)
      client = new PrismaClient({ adapter: new PrismaPg(pool) })
      state.client = client
      userIds = []
      for (const name of ['ChatOne', 'ChatTwo', 'ChatThree']) {
        const user = await client.user.create({
          data: {
            name,
            email: `${name}@example.invalid`,
            password: 'synthetic-no-login'
          }
        })
        userIds.push(user.id)
      }
      conversationId = (
        await client.user_conversation.create({
          data: { user_a_id: userIds[0], user_b_id: userIds[1] }
        })
      ).id
      otherConversationId = (
        await client.user_conversation.create({
          data: {
            user_a_id: userIds[0],
            user_b_id: userIds[2],
            user_a_unread_count: 9,
            user_b_unread_count: 11
          }
        })
      ).id
      service = await import('~/app/api/message/conversation/[id]/service')
    })
    afterAll(async () => {
      state.gate = undefined
      state.client = undefined
      await client?.$disconnect()
      await pool?.end()
    })

    it('send then read commits status and count together, preserving opposite and other counts', async () => {
      await reset()
      await interleave(send, confirm)
      expect(await row()).toMatchObject({
        user_a_unread_count: 0,
        user_b_unread_count: 7
      })
      expect(
        await client.user_private_message.count({
          where: { conversation_id: conversationId, status: 0 }
        })
      ).toBe(0)
      expect(
        await client.user_conversation.findUniqueOrThrow({
          where: { id: otherConversationId }
        })
      ).toMatchObject({ user_a_unread_count: 9, user_b_unread_count: 11 })
    })

    it('read then send leaves exactly the later message unread', async () => {
      await reset()
      await interleave(confirm, send)
      expect(await row()).toMatchObject({
        user_a_unread_count: 1,
        user_b_unread_count: 7
      })
      expect(
        await client.user_private_message.count({
          where: { conversation_id: conversationId, status: 0 }
        })
      ).toBe(1)
    })

    it('repairs zero-count unread history and repeats range confirmation without affecting later pulls', async () => {
      await reset()
      await send()
      await client.user_conversation.update({
        where: { id: conversationId },
        data: { user_a_unread_count: 0 }
      })
      const first = await confirm()
      expect(await confirm()).toEqual(first)
      expect(
        await client.user_private_message.count({
          where: { conversation_id: conversationId, status: 0 }
        })
      ).toBe(0)
      expect(
        (
          (await service.getConversationMessages(
            conversationId,
            { page: 1, limit: 50, afterId: 0 },
            userIds[0]
          )) as ConversationMessagesResponse
        ).messages
      ).toHaveLength(1)
    })

    it('hide then send reopens with the later count and send then hide clears only the viewer count', async () => {
      await reset()
      await interleave(
        () => service.deleteConversation(conversationId, userIds[0]),
        send
      )
      expect(await row()).toMatchObject({
        user_a_hidden: false,
        user_a_unread_count: 1,
        user_b_unread_count: 7
      })
      await reset()
      await interleave(send, () =>
        service.deleteConversation(conversationId, userIds[0])
      )
      expect(await row()).toMatchObject({
        user_a_hidden: true,
        user_a_unread_count: 0,
        user_b_unread_count: 7
      })
    })

    it('rolls back message insertion and range confirmation when the counter update fails', async () => {
      await reset()
      state.failUpdate = true
      await expect(send()).rejects.toThrow('Synthetic rollback')
      state.failUpdate = false
      expect(
        await client.user_private_message.count({
          where: { conversation_id: conversationId }
        })
      ).toBe(0)
      await send()
      state.failUpdate = true
      await expect(confirm()).rejects.toThrow('Synthetic rollback')
      state.failUpdate = false
      expect(await row()).toMatchObject({ user_a_unread_count: 1 })
      expect(
        await client.user_private_message.count({
          where: { conversation_id: conversationId, status: 0 }
        })
      ).toBe(1)
    })

    it('covers first/history/new with 85 pending, gaps, reverse and equal times, retry and concurrent sends', async () => {
      await reset()
      for (let index = 0; index < 60; index++)
        await send(`Synthetic seed ${index}`)
      const first = (await service.getConversationMessages(
        conversationId,
        { page: 1, limit: 50 },
        userIds[0]
      )) as ConversationMessagesResponse
      expect(first.messages).toHaveLength(50)
      for (let index = 0; index < 85; index++) {
        if (index === 20) {
          state.failUpdate = true
          await expect(send()).rejects.toThrow()
          state.failUpdate = false
        }
        await send(`Synthetic backlog ${index}`)
      }
      const allRows = await client.user_private_message.findMany({
        where: { conversation_id: conversationId },
        orderBy: { id: 'asc' }
      })
      for (const [index, message] of allRows.entries())
        await client.user_private_message.update({
          where: { id: message.id },
          data: {
            created: new Date(index < 80 ? 100000 : 200000 - index * 100)
          }
        })
      await confirm()
      const history = (await service.getConversationMessages(
        conversationId,
        { page: 1, limit: 50, beforeId: first.oldestId! },
        userIds[0]
      )) as ConversationMessagesResponse
      const next = (await service.getConversationMessages(
        conversationId,
        { page: 1, limit: 50, afterId: first.latestId! },
        userIds[0]
      )) as ConversationMessagesResponse
      expect(next.messages).toHaveLength(50)
      expect(next.hasMoreAfter).toBe(true)
      const cursor = next.latestId!
      const original = state.client!
      state.client = new Proxy(original, {
        get: (target, property) =>
          property === 'user_private_message'
            ? new Proxy(target.user_private_message, {
                get: (delegate, operation) =>
                  operation === 'findMany'
                    ? () => {
                        throw new Error('Synthetic batch failure')
                      }
                    : Reflect.get(delegate, operation)
              })
            : Reflect.get(target, property)
      })
      await expect(
        service.getConversationMessages(
          conversationId,
          { page: 1, limit: 50, afterId: cursor },
          userIds[0]
        )
      ).rejects.toThrow('Synthetic batch failure')
      state.client = original
      await Promise.all([send('Concurrent one'), send('Concurrent two')])
      const retry = (await service.getConversationMessages(
        conversationId,
        { page: 1, limit: 50, afterId: cursor },
        userIds[0]
      )) as ConversationMessagesResponse
      const ids = [
        ...history.messages,
        ...first.messages,
        ...next.messages,
        ...retry.messages
      ].map((message) => message.id)
      const expected = await client.user_private_message.findMany({
        where: { conversation_id: conversationId },
        orderBy: { id: 'asc' },
        select: { id: true }
      })
      expect(ids).toEqual(expected.map((message) => message.id))
      expect(new Set(ids).size).toBe(147)
      expect(await row()).toMatchObject({
        user_a_unread_count: 2,
        user_b_unread_count: 7
      })
    })
    it.skipIf(!process.env.KUN_PRIVATE_CHAT_CONTROL_ROOT)(
      'uses the exact deployment controller after actual private chat writes and candidate failure',
      async () => {
        await reset()
        const root = process.env.KUN_PRIVATE_CHAT_CONTROL_ROOT!
        const password = process.env.KUN_PRIVATE_CHAT_CONTROL_PASSWORD!
        if (!/^[a-f0-9]{64}$/.test(password))
          throw new Error('A synthetic control password is required')
        const { DeployWriteControl } = await import(
          `${root}/deployWriteControl.ts`
        )
        const {
          hashReleaseArtifact,
          assertCompatibilityEvidence,
          requiredCompatibilityChecks
        } = await import(`${root}/deployCompatibility.ts`)
        const admin = await pool.connect()
        const fixture = await mkdtemp(join(tmpdir(), 'private-chat-artifact-'))
        let runtimePool: Pool | undefined
        let acceptancePool: Pool | undefined
        let runtime: PrismaClient | undefined
        let acceptance: PrismaClient | undefined
        try {
          await admin.query(
            `CREATE ROLE private_chat_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'; CREATE ROLE private_chat_acceptance LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`
          )
          await admin.query(
            'GRANT USAGE ON SCHEMA public TO private_chat_runtime, private_chat_acceptance; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO private_chat_runtime, private_chat_acceptance; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO private_chat_runtime, private_chat_acceptance'
          )
          const controller = new DeployWriteControl(admin)
          await controller.install(
            'private_chat_runtime',
            'private_chat_acceptance'
          )
          await controller.setSemantics(['private-chat-v1'])
          const snapshot = await controller.snapshot()
          const connection = (role: string) => {
            const url = new URL(databaseUrl!)
            url.username = role
            return new pg.Pool({ connectionString: url.href, max: 2 })
          }
          runtimePool = connection('private_chat_runtime')
          runtime = new PrismaClient({ adapter: new PrismaPg(runtimePool) })
          state.client = runtime
          await expect(send('Frozen business write')).rejects.toThrow()
          await controller.open(snapshot)
          const sent = await send(
            'Actual private chat before candidate failure'
          )
          expect(sent).toMatchObject({
            content: 'Actual private chat before candidate failure'
          })
          await controller.freeze()
          await controller.acceptance(60)
          acceptancePool = connection('private_chat_acceptance')
          acceptance = new PrismaClient({
            adapter: new PrismaPg(acceptancePool)
          })
          state.client = acceptance
          await send('Actual candidate write')
          await confirm()
          state.failUpdate = true
          await expect(send('Candidate transaction failure')).rejects.toThrow(
            'Synthetic rollback'
          )
          state.failUpdate = false
          await acceptance.$disconnect()
          await acceptancePool.end()
          acceptancePool = undefined
          acceptance = undefined
          await controller.freeze()
          const frozen = await controller.snapshot()
          expect(frozen).toMatchObject({
            frozen: true,
            semantics: ['private-chat-v1']
          })
          state.client = runtime
          await expect(
            send('Runtime after candidate failure')
          ).rejects.toThrow()
          const source = await readFile(
            'app/api/message/conversation/[id]/service.ts'
          )
          await writeFile(join(fixture, 'private-chat-service.ts'), source)
          const artifactHash = await hashReleaseArtifact(fixture)
          const commitSha = process.env.KUN_PRIVATE_CHAT_SOURCE_SHA!
          const receipt = {
            version: 1,
            passed: true,
            databaseId: frozen.databaseId,
            schemaHash: frozen.schemaHash,
            semantics: ['private-chat-v1'],
            artifactHash,
            commitSha,
            tag: 'private-chat-acceptance',
            checks: requiredCompatibilityChecks
          }
          const parameters = {
            snapshot: frozen,
            artifactHash,
            commitSha,
            tag: receipt.tag
          }
          expect(() =>
            assertCompatibilityEvidence({
              ...parameters,
              evidence: { ...receipt, semantics: [] }
            })
          ).toThrow('No verified compatible artifact')
          expect(() =>
            assertCompatibilityEvidence({
              ...parameters,
              evidence: { ...receipt, artifactHash: 'changed' }
            })
          ).toThrow('No verified compatible artifact')
          expect(
            assertCompatibilityEvidence({ ...parameters, evidence: receipt })
          ).toEqual(receipt)
          await controller.open(frozen)
          await send('Actual private chat after compatible recovery')
          expect(await row()).toMatchObject({
            user_a_unread_count: 1,
            user_b_unread_count: 7
          })
          expect(
            await client.user_private_message.count({
              where: { conversation_id: conversationId }
            })
          ).toBe(3)
          console.log(
            JSON.stringify({
              controlCommit: '97613cb939fabe5e140082b0c0b86c5398be4044',
              sourceCommit: commitSha,
              artifactHash,
              semantics: frozen.semantics,
              actualBusinessWrites: 3,
              candidateFailureRolledBack: true,
              incompatibleRecoveryRejected: true,
              compatibleRecoveryVerified: true,
              productionArtifact: false
            })
          )
        } finally {
          state.client = client
          state.failUpdate = false
          await acceptance?.$disconnect()
          await acceptancePool?.end()
          await runtime?.$disconnect()
          await runtimePool?.end()
          admin.release()
          await rm(fixture, { recursive: true, force: true })
        }
      }
    )
  }
)
