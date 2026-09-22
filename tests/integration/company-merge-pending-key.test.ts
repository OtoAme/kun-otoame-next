import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Real PostgreSQL check for pending-key uniqueness. Skipped unless
 * KUN_COMPANY_MERGE_TEST_DATABASE_URL points at a disposable database.
 * Never use otoame_prod_dump or touchgal. Unit tests do not replace this.
 */
const databaseUrl = process.env.KUN_COMPANY_MERGE_TEST_DATABASE_URL?.trim()

const pointsAtForbiddenDatabase = (url: string) => {
  let name = url
  try {
    name = new URL(url).pathname
  } catch {
    name = url
  }
  return /otoame_prod_dump|touchgal/i.test(name)
}

describe.skipIf(!databaseUrl)('company_merge_pending_key concurrency', () => {
  let pool: InstanceType<typeof pg.Pool> | undefined
  let schema = ''

  const connect = async () => {
    if (!pool) throw new Error('company merge test pool was not started')
    const client = await pool.connect()
    await client.query(`SET search_path TO ${schema}`)
    return client
  }

  beforeAll(async () => {
    if (!databaseUrl || pointsAtForbiddenDatabase(databaseUrl)) {
      throw new Error(
        'KUN_COMPANY_MERGE_TEST_DATABASE_URL must be a disposable database, not otoame_prod_dump or touchgal'
      )
    }
    schema = `cm_merge_${Date.now()}`
    pool = new pg.Pool({ connectionString: databaseUrl, max: 4 })
    const admin = await pool.connect()
    try {
      await admin.query(`CREATE SCHEMA ${schema}`)
      await admin.query(`SET search_path TO ${schema}`)
      await admin.query(`
        CREATE TABLE company_merge_suggestion (
          id SERIAL PRIMARY KEY,
          kind VARCHAR(32) NOT NULL,
          status VARCHAR(16) NOT NULL,
          folded_key VARCHAR(107) NOT NULL,
          target_company_id INTEGER NOT NULL,
          source_company_ids INTEGER[],
          names TEXT[],
          evidence JSONB NOT NULL,
          member_key VARCHAR(512) NOT NULL,
          candidate_key VARCHAR(512),
          detected_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          resolved_at TIMESTAMP(3),
          resolved_by_user_id INTEGER,
          created TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `)
      await admin.query(`
        CREATE TABLE company_merge_pending_key (
          member_key VARCHAR(512) PRIMARY KEY,
          suggestion_id INTEGER NOT NULL UNIQUE
            REFERENCES company_merge_suggestion (id) ON DELETE RESTRICT,
          created TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `)
    } finally {
      admin.release()
    }
  })

  afterAll(async () => {
    if (!pool || !schema) return
    const admin = await pool.connect()
    try {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    } finally {
      admin.release()
      await pool.end()
    }
  })

  it('rolls back the losing insert and still shows the winning pending row', async () => {
    const winner = await connect()
    const loser = await connect()
    try {
      await winner.query('BEGIN')
      await loser.query('BEGIN')
      const inserted = await winner.query<{ id: number }>(
        `INSERT INTO company_merge_suggestion
          (kind, status, folded_key, target_company_id, source_company_ids, names, evidence, member_key)
         VALUES ('source-pair', 'pending', 'vndb:p5101', 407, ARRAY[408, 409], ARRAY['a','b','c'], '{"hits":[]}'::jsonb, '407,408,409')
         RETURNING id`
      )
      const winnerId = inserted.rows[0]?.id
      await winner.query(
        `INSERT INTO company_merge_pending_key (member_key, suggestion_id) VALUES ('407,408,409', $1)`,
        [winnerId]
      )
      const loserInsert = await loser.query<{ id: number }>(
        `INSERT INTO company_merge_suggestion
          (kind, status, folded_key, target_company_id, source_company_ids, names, evidence, member_key)
         VALUES ('source-pair', 'pending', 'vndb:p5101', 407, ARRAY[408, 409], ARRAY['a','b','c'], '{"hits":[]}'::jsonb, '407,408,409')
         RETURNING id`
      )
      const loserId = loserInsert.rows[0]?.id
      const keyInsert = loser.query(
        `INSERT INTO company_merge_pending_key (member_key, suggestion_id) VALUES ('407,408,409', $1)`,
        [loserId]
      )
      await winner.query('COMMIT')
      await expect(keyInsert).rejects.toMatchObject({ code: '23505' })
      await loser.query('ROLLBACK')

      const visible = await loser.query<{ id: number; status: string }>(
        `SELECT id, status FROM company_merge_suggestion WHERE member_key = '407,408,409' AND status = 'pending'`
      )
      expect(visible.rows).toEqual([{ id: winnerId, status: 'pending' }])
      const orphan = await loser.query(
        `SELECT id FROM company_merge_suggestion WHERE id = $1`,
        [loserId]
      )
      expect(orphan.rows).toEqual([])
      const keys = await loser.query(
        `SELECT suggestion_id FROM company_merge_pending_key WHERE member_key = '407,408,409'`
      )
      expect(keys.rows).toEqual([{ suggestion_id: winnerId }])
    } finally {
      winner.release()
      loser.release()
    }
  })
})
