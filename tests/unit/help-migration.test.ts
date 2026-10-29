import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const readProjectFile = (path: string) =>
  readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

const preflightPath = 'migration/production-help-preflight-2026-10-29.sql'
const syncPath = 'migration/production-help-sync-2026-10-29.sql'
const postflightPath = 'migration/production-help-postflight-2026-10-29.sql'

const stripSqlComments = (sql: string) =>
  sql.replaceAll(/--.*$/gm, '').replaceAll(/\/\*[\s\S]*?\*\//g, '')

describe('production help migration contract', () => {
  it('keeps preflight and postflight read-only', async () => {
    const [preflight, postflight] = await Promise.all([
      readProjectFile(preflightPath),
      readProjectFile(postflightPath)
    ])
    for (const sql of [preflight, postflight]) {
      expect(sql).toContain('\\set ON_ERROR_STOP on')
      expect(sql).toContain('BEGIN TRANSACTION READ ONLY')
      expect(stripSqlComments(sql)).not.toMatch(
        /\b(CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\b/i
      )
    }
  })

  it('only creates help tables with bounded settings', async () => {
    const sync = stripSqlComments(await readProjectFile(syncPath))
    expect(sync).toContain("SET LOCAL lock_timeout = '5s'")
    expect(sync).toContain("SET LOCAL statement_timeout = '60s'")
    expect(sync).toContain('existing help tables are partial or incompatible')
    const statements = sync.replaceAll(
      /ON (DELETE|UPDATE) (SET NULL|CASCADE|NO ACTION)/gi,
      ''
    )
    expect(statements).not.toMatch(
      /\b(ALTER TABLE|DROP|TRUNCATE|UPDATE|DELETE)\b/i
    )
    // The Prisma 7.8 patch_released_idx difference is never applied here.
    expect(sync).not.toContain('patch_released_idx')
    for (const table of [
      'help_post',
      'help_answer',
      'help_answer_vote',
      'help_follow',
      'help_daily_quota',
      'help_reply'
    ]) {
      expect(sync).toContain(`CREATE TABLE IF NOT EXISTS public.${table} (`)
    }
  })

  it('keeps authors as SET NULL so accounting and reports outlive accounts', async () => {
    const sync = stripSqlComments(await readProjectFile(syncPath))
    expect(sync).toMatch(
      /help_post_user_id_fkey[\s\S]*?REFERENCES public\."user"\(id\)[\s\S]*?ON DELETE SET NULL/
    )
    expect(sync).toMatch(
      /help_answer_user_id_fkey[\s\S]*?REFERENCES public\."user"\(id\)[\s\S]*?ON DELETE SET NULL/
    )
    expect(sync).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS help_post_user_id_request_id_key/
    )
  })
})
