import pg, { type Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  lockPreferenceTags,
  maintainBlockedTagPreferences,
  prepareAccountPreferenceDeletion,
  readPreferenceSnapshot,
  saveAccountPreferences,
  setControlledEmailNotice
} from '~/lib/accountPreferences/service'

const databaseUrl = process.env.KUN_ACCOUNT_PREFERENCES_TEST_DATABASE_URL
const nonce = process.env.KUN_ACCOUNT_PREFERENCES_TEST_NONCE
const context = 'a'.repeat(64)

describe.skipIf(!databaseUrl)(
  'account preferences on disposable PostgreSQL',
  () => {
    let database: PrismaClient
    let pool: Pool
    let sequence = 0
    const account = () =>
      database.user.create({
        data: {
          name: `pref_${++sequence}`,
          email: `pref_${sequence}@example.test`,
          password: 'synthetic',
          enable_email_notice: false
        }
      })
    const tag = (uid: number) =>
      database.patch_tag.create({
        data: {
          name: `pref_tag_${++sequence}`,
          user_id: uid,
          alias: []
        }
      })
    beforeAll(async () => {
      const target = new URL(databaseUrl!)
      if (
        target.hostname !== '127.0.0.1' ||
        !target.port ||
        target.port === '5432' ||
        !/^\/account_preferences_[a-f0-9]+_e2e$/.test(target.pathname) ||
        !nonce
      ) {
        throw new Error(
          'Explicit disposable account preference database required'
        )
      }
      pool = new pg.Pool({ connectionString: databaseUrl, max: 8 })
      const identity = await pool.query(
        'SELECT current_database() AS name, nonce FROM acceptance_identity'
      )
      expect(identity.rows).toEqual([{ name: target.pathname.slice(1), nonce }])
      database = new PrismaClient({ adapter: new PrismaPg(pool) })
    })
    afterAll(async () => {
      await database?.$disconnect()
      await pool?.end()
    })

    it('distinguishes an initial default from an explicit SFW choice and keeps retries stable', async () => {
      const user = await account()
      expect(
        await readPreferenceSnapshot(database, user.id, context)
      ).toMatchObject({
        version: 0,
        nsfwSelected: false,
        items: { nsfw: { value: 'sfw', version: 0 } }
      })
      const request = [{ key: 'nsfw', value: 'sfw' as const, version: 0 }]
      const first = await saveAccountPreferences(
        database,
        user.id,
        context,
        request
      )
      const retry = await saveAccountPreferences(
        database,
        user.id,
        context,
        request
      )
      expect(first).toMatchObject({ version: 1, nsfwSelected: true })
      expect(retry).toEqual(first)
    })

    it('serializes competing changes to one item and accepts independent items', async () => {
      const user = await account()
      const results = await Promise.all([
        saveAccountPreferences(database, user.id, context, [
          { key: 'nsfw', value: 'all', version: 0 }
        ]),
        saveAccountPreferences(database, user.id, context, [
          { key: 'nsfw', value: 'nsfw', version: 0 }
        ])
      ])
      expect(results.filter((result) => 'code' in result)).toHaveLength(1)
      const other = await account()
      const tags = await Promise.all([tag(other.id), tag(other.id)])
      const parallel = await Promise.all(
        tags.map((current) =>
          saveAccountPreferences(database, other.id, context, [
            { key: `blocked-tag:${current.id}`, value: true, version: 0 }
          ])
        )
      )
      expect(parallel.every((result) => !('code' in result))).toBe(true)
      expect(
        (
          await readPreferenceSnapshot(database, other.id, context)
        ).blockedTagIds.sort()
      ).toEqual(tags.map((current) => current.id).sort())
    })

    it('preserves cancelled-item versions and rejects a delayed old request', async () => {
      const user = await account()
      const target = await tag(user.id)
      const key = `blocked-tag:${target.id}`
      await saveAccountPreferences(database, user.id, context, [
        { key, value: true, version: 0 }
      ])
      await saveAccountPreferences(database, user.id, context, [
        { key, value: false, version: 1 }
      ])
      const late = await saveAccountPreferences(database, user.id, context, [
        { key, value: true, version: 0 }
      ])
      expect(late).toMatchObject({
        code: 'PREFERENCE_CONFLICT',
        conflicts: [key]
      })
      expect(
        (await readPreferenceSnapshot(database, user.id, context)).items
      ).not.toHaveProperty(key)
      expect(
        (await readPreferenceSnapshot(database, user.id, context, [key])).items[
          key
        ]
      ).toEqual({ value: false, version: 2 })
    })

    it('does not replay a lost-response intent over a later device change', async () => {
      const user = await account()
      const original = [{ key: 'nsfw', value: 'all' as const, version: 0 }]
      await saveAccountPreferences(database, user.id, context, original)
      await saveAccountPreferences(database, user.id, context, [
        { key: 'nsfw', value: 'sfw', version: 1 }
      ])
      expect(
        await saveAccountPreferences(database, user.id, context, original)
      ).toMatchObject({ code: 'PREFERENCE_CONFLICT' })
      expect(
        await readPreferenceSnapshot(database, user.id, context)
      ).toMatchObject({
        version: 2,
        items: { nsfw: { value: 'sfw', version: 2 } }
      })
    })

    it('rolls back a multi-item request when one item conflicts', async () => {
      const user = await account()
      await saveAccountPreferences(database, user.id, context, [
        { key: 'nsfw', value: 'all', version: 0 }
      ])
      const result = await saveAccountPreferences(database, user.id, context, [
        { key: 'nsfw', value: 'sfw', version: 0 },
        { key: 'email-notice', value: true, version: 0 }
      ])
      expect(result).toMatchObject({ code: 'PREFERENCE_CONFLICT' })
      expect(
        await readPreferenceSnapshot(database, user.id, context)
      ).toMatchObject({
        version: 1,
        items: { 'email-notice': { value: false, version: 0 } }
      })
    })

    it('keeps values and versions from the same statement during an uncommitted write', async () => {
      const user = await account()
      let entered!: () => void
      let release!: () => void
      const ready = new Promise<void>((resolve) => {
        entered = resolve
      })
      const hold = new Promise<void>((resolve) => {
        release = resolve
      })
      const writing = database.$transaction(async (transaction) => {
        await transaction.account_preference_version.create({
          data: { user_id: user.id, setting_key: 'nsfw', version: 1 }
        })
        entered()
        await hold
        await transaction.user.update({
          where: { id: user.id },
          data: { nsfw_mode: 'all', preference_version: 1 }
        })
      })
      await ready
      try {
        expect(
          await readPreferenceSnapshot(database, user.id, context)
        ).toMatchObject({
          version: 0,
          nsfwSelected: false,
          items: { nsfw: { value: 'sfw', version: 0 } }
        })
      } finally {
        release()
      }
      await writing
      expect(
        await readPreferenceSnapshot(database, user.id, context)
      ).toMatchObject({
        version: 1,
        items: { nsfw: { value: 'all', version: 1 } }
      })
    })

    it('coordinates tag merge, deletion and unrelated personal writes', async () => {
      const user = await account()
      const source = await tag(user.id)
      const target = await tag(user.id)
      const extra = await tag(user.id)
      await saveAccountPreferences(database, user.id, context, [
        { key: `blocked-tag:${source.id}`, value: true, version: 0 }
      ])
      await Promise.all([
        database.$transaction(async (transaction) => {
          await lockPreferenceTags(transaction, [source.id, target.id])
          await maintainBlockedTagPreferences(
            transaction,
            [source.id],
            target.id
          )
          await transaction.patch_tag.delete({ where: { id: source.id } })
        }),
        saveAccountPreferences(database, user.id, context, [
          { key: `blocked-tag:${extra.id}`, value: true, version: 0 }
        ])
      ])
      expect(
        (
          await readPreferenceSnapshot(database, user.id, context)
        ).blockedTagIds.sort()
      ).toEqual([target.id, extra.id].sort())
      await expect(
        saveAccountPreferences(database, user.id, context, [
          { key: `blocked-tag:${source.id}`, value: true, version: 0 }
        ])
      ).rejects.toMatchObject({ code: 'PREFERENCE_TARGET_CHANGED' })
      const outcomes = await Promise.allSettled([
        database.$transaction(async (transaction) => {
          await lockPreferenceTags(transaction, [target.id])
          await maintainBlockedTagPreferences(transaction, [target.id])
          await transaction.patch_tag.delete({ where: { id: target.id } })
        }),
        saveAccountPreferences(database, user.id, context, [
          { key: `blocked-tag:${target.id}`, value: false, version: 1 }
        ])
      ])
      expect(outcomes[0].status).toBe('fulfilled')
      expect(
        (await readPreferenceSnapshot(database, user.id, context)).blockedTagIds
      ).toEqual([extra.id])
    })

    it('coordinates account cascade deletion with another user blocking its owned tag', async () => {
      const owner = await account()
      const reader = await account()
      const owned = await tag(owner.id)
      await saveAccountPreferences(database, reader.id, context, [
        { key: `blocked-tag:${owned.id}`, value: true, version: 0 }
      ])
      const outcomes = await Promise.allSettled([
        database.$transaction(async (transaction) => {
          await prepareAccountPreferenceDeletion(transaction, owner.id)
          await transaction.user.delete({ where: { id: owner.id } })
        }),
        saveAccountPreferences(database, reader.id, context, [
          { key: `blocked-tag:${owned.id}`, value: false, version: 1 }
        ])
      ])
      expect(outcomes[0].status).toBe('fulfilled')
      expect(
        await database.user.findUnique({ where: { id: owner.id } })
      ).toBeNull()
      expect(
        (await readPreferenceSnapshot(database, reader.id, context))
          .blockedTagIds
      ).toEqual([])
      expect(
        await database.account_preference_version.count({
          where: { user_id: owner.id }
        })
      ).toBe(0)
    })

    it('uses the same version service for controlled email unsubscribe', async () => {
      const user = await account()
      await saveAccountPreferences(database, user.id, context, [
        { key: 'email-notice', value: true, version: 0 }
      ])
      await database.$transaction((transaction) =>
        setControlledEmailNotice(transaction, user.id, false)
      )
      expect(
        await saveAccountPreferences(database, user.id, context, [
          { key: 'email-notice', value: true, version: 1 }
        ])
      ).toMatchObject({ code: 'PREFERENCE_CONFLICT' })
      const current = await readPreferenceSnapshot(database, user.id, context)
      await database.$transaction((transaction) =>
        setControlledEmailNotice(transaction, user.id, false)
      )
      expect(await readPreferenceSnapshot(database, user.id, context)).toEqual(
        current
      )
    })
  }
)
