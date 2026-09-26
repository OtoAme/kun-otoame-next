import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const readProjectFile = (path: string) =>
  readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

const preflightPath =
  'migration/production-case-feedback-preflight-2026-09-26.sql'
const syncPath = 'migration/production-case-feedback-sync-2026-09-26.sql'
const postflightPath =
  'migration/production-case-feedback-postflight-2026-09-26.sql'

const stripSqlComments = (sql: string) =>
  sql.replaceAll(/--.*$/gm, '').replaceAll(/\/\*[\s\S]*?\*\//g, '')

describe('production case feedback migration contract', () => {
  it('keeps preflight and postflight read-only', async () => {
    const [preflight, postflight] = await Promise.all([
      readProjectFile(preflightPath),
      readProjectFile(postflightPath)
    ])

    for (const sql of [preflight, postflight]) {
      expect(sql).toContain('\\set ON_ERROR_STOP on')
      expect(sql).toContain('BEGIN TRANSACTION READ ONLY')
      expect(sql).toContain('COMMIT')
      expect(stripSqlComments(sql)).not.toMatch(
        /\b(CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\b/i
      )
    }
  })

  it('requires the 2026-09-13 base tables before touching anything', async () => {
    const [preflight, sync] = await Promise.all([
      readProjectFile(preflightPath),
      readProjectFile(syncPath)
    ])

    for (const sql of [preflight, sync]) {
      expect(sql).toContain("to_regclass('public.ops_case') IS NULL")
      expect(sql).toContain("to_regclass('public.ops_case_message') IS NULL")
    }
  })

  it('uses a bounded, add-only transactional sync guarded before any DDL', async () => {
    const sync = stripSqlComments(await readProjectFile(syncPath))

    expect(sync).toContain("SET LOCAL lock_timeout = '5s'")
    expect(sync).toContain("SET LOCAL statement_timeout = '60s'")
    expect(sync).toContain('BEGIN;')
    expect(sync).toContain('COMMIT;')
    expect(sync).not.toMatch(/ALTER COLUMN/i)
    expect(sync).not.toMatch(
      /\b(DROP|TRUNCATE|INSERT INTO|UPDATE public|DELETE FROM)\b/i
    )
    expect(sync).toContain(
      'ADD COLUMN IF NOT EXISTS reminded_revision INTEGER;'
    )
    expect(sync).toContain(
      'CREATE TABLE IF NOT EXISTS public.ops_case_message_image'
    )

    const guardPosition = sync.indexOf('DO $existing_target_guard$')
    expect(guardPosition).toBeGreaterThanOrEqual(0)
    expect(sync.indexOf('ADD COLUMN IF NOT EXISTS')).toBeGreaterThan(
      guardPosition
    )
    expect(sync.indexOf('CREATE TABLE IF NOT EXISTS')).toBeGreaterThan(
      guardPosition
    )
  })

  it('matches the Prisma image table columns, cascade FK and unique index', async () => {
    const sync = stripSqlComments(await readProjectFile(syncPath))
    const normalized = sync.replace(/\s+/g, ' ')

    for (const column of [
      'id SERIAL PRIMARY KEY',
      'message_id INTEGER NOT NULL',
      'storage_key VARCHAR(1007) NOT NULL',
      'sort INTEGER NOT NULL',
      'created TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP'
    ]) {
      expect(normalized).toContain(column)
    }
    expect(normalized).toContain(
      'ADD CONSTRAINT ops_case_message_image_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.ops_case_message(id) ON DELETE CASCADE ON UPDATE NO ACTION'
    )
    expect(sync).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS ops_case_message_image_message_id_sort_key\n  ON public.ops_case_message_image (message_id, sort);'
    )
  })

  it('refuses incompatible existing objects and verifies them afterwards', async () => {
    const [sync, postflight] = await Promise.all([
      readProjectFile(syncPath),
      readProjectFile(postflightPath)
    ])

    expect(sync).toContain(
      'public.ops_case.reminded_revision is incompatible'
    )
    expect(sync).toContain(
      'public.ops_case_message_image is partial or incompatible'
    )
    for (const sql of [sync, postflight]) {
      expect(sql).toContain('indnullsnotdistinct')
      expect(sql).toContain("confdeltype::text <> 'c'")
      expect(sql).toContain("confupdtype::text <> 'a'")
      expect(sql).toContain('pg_get_indexdef')
    }
    expect(postflight).toContain("'ops_case_message_image_pkey'")
    expect(postflight).toContain(
      "'ops_case_message_image_message_id_sort_key'"
    )
  })
})
