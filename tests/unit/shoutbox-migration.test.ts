import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const readProjectFile = (path: string) =>
  readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

const preflightPath = 'migration/production-shoutbox-preflight-2026-09-11.sql'
const syncPath = 'migration/production-shoutbox-sync-2026-09-11.sql'
const postflightPath = 'migration/production-shoutbox-postflight-2026-09-11.sql'

const stripSqlComments = (sql: string) =>
  sql.replaceAll(/--.*$/gm, '').replaceAll(/\/\*[\s\S]*?\*\//g, '')

describe('production shoutbox migration contract', () => {
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

  it('uses bounded sync settings and refuses partial shoutbox tables', async () => {
    const sync = await readProjectFile(syncPath)

    expect(sync).toContain("SET LOCAL lock_timeout = '5s'")
    expect(sync).toContain("SET LOCAL statement_timeout = '60s'")
    expect(sync).toContain('existing table is partial or incompatible')
    expect(sync).not.toMatch(
      /ALTER TABLE public\.shoutbox[\s\S]*ADD COLUMN IF NOT EXISTS/i
    )
  })

  it('creates the two shoutbox foreign keys required by postflight', async () => {
    const sync = await readProjectFile(syncPath)

    expect(sync).toMatch(
      /CONSTRAINT shoutbox_user_id_fkey[\s\S]*FOREIGN KEY \(user_id\)[\s\S]*REFERENCES public\."user"\(id\)[\s\S]*ON DELETE CASCADE[\s\S]*ON UPDATE NO ACTION/i
    )
    expect(sync).toMatch(
      /CONSTRAINT shoutbox_patch_id_fkey[\s\S]*FOREIGN KEY \(patch_id\)[\s\S]*REFERENCES public\.patch\(id\)[\s\S]*ON DELETE SET NULL[\s\S]*ON UPDATE NO ACTION/i
    )
  })

  it('extends patch reports with nullable patch and indexed shoutbox targets', async () => {
    const sync = stripSqlComments(await readProjectFile(syncPath))

    expect(sync).toMatch(
      /ALTER TABLE public\.patch_report\s+ADD COLUMN IF NOT EXISTS shoutbox_id INTEGER,\s+ALTER COLUMN patch_id DROP NOT NULL/i
    )
    expect(sync).toMatch(
      /CONSTRAINT patch_report_shoutbox_id_fkey[\s\S]*FOREIGN KEY \(shoutbox_id\)[\s\S]*REFERENCES public\.shoutbox\(id\)[\s\S]*ON DELETE SET NULL/i
    )
    expect(sync).toContain(
      'CREATE INDEX IF NOT EXISTS patch_report_target_type_shoutbox_id_status_idx'
    )
  })

  it('locks the sync CHECK constraints to the approved shape', async () => {
    const sync = stripSqlComments(await readProjectFile(syncPath))

    expect(sync).toContain('CHECK (status IN (0, 1, 2, 3))')
    expect(sync).toContain("CHECK (level IN ('normal', 'important'))")
    expect(sync).toContain('CHECK (cost >= 0)')
    expect(sync).toMatch(
      /official = TRUE[\s\S]*effective_from IS NOT NULL[\s\S]*effective_to IS NOT NULL[\s\S]*effective_to > effective_from[\s\S]*official = FALSE[\s\S]*level = 'normal'[\s\S]*effective_from IS NULL[\s\S]*effective_to IS NULL[\s\S]*link = ''/i
    )
  })

  it('checks actual column defaults, index state, and referential definitions', async () => {
    const postflight = await readProjectFile(postflightPath)

    for (const contract of [
      'datetime_precision',
      'column_default',
      'pg_get_indexdef',
      'indisunique',
      'indisvalid',
      'indisready',
      'indislive',
      'pg_get_constraintdef',
      'convalidated',
      'confdeltype',
      'confupdtype',
      'conkey',
      'confkey'
    ]) {
      expect(postflight).toContain(contract)
    }
    expect(postflight).toContain('source columns mismatch')
    expect(postflight).toContain('FK constraint')
  })
})
