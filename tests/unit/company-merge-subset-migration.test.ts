import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const readProjectFile = (path: string) =>
  readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

const stripSqlComments = (sql: string) =>
  sql.replaceAll(/--.*$/gm, '').replaceAll(/\/\*[\s\S]*?\*\//g, '')

const files = {
  preflight: 'migration/production-company-merge-subset-preflight-2026-09-22.sql',
  syncA: 'migration/production-company-merge-subset-sync-a-2026-09-22.sql',
  syncB: 'migration/production-company-merge-subset-sync-b-2026-09-22.sql',
  preflight2:
    'migration/production-company-merge-subset-preflight-2-2026-09-22.sql',
  syncC: 'migration/production-company-merge-subset-sync-c-2026-09-22.sql',
  postflight:
    'migration/production-company-merge-subset-postflight-2026-09-22.sql',
  rollback: 'migration/production-company-merge-subset-rollback-2026-09-22.sql'
}

describe('company merge subset migration contract', () => {
  it('keeps preflight, preflight-2, and postflight read-only', async () => {
    const sql = await Promise.all([
      readProjectFile(files.preflight),
      readProjectFile(files.preflight2),
      readProjectFile(files.postflight)
    ])
    for (const file of sql) {
      expect(file).toContain('\\set ON_ERROR_STOP on')
      expect(file).toContain('BEGIN TRANSACTION READ ONLY')
      expect(stripSqlComments(file)).not.toMatch(
        /\b(CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\b/i
      )
    }
  })

  it('adds nullable columns before backfill and NOT NULL', async () => {
    const [syncA, syncB, syncC] = await Promise.all([
      readProjectFile(files.syncA),
      readProjectFile(files.syncB),
      readProjectFile(files.syncC)
    ])
    expect(syncA).toContain('ADD COLUMN IF NOT EXISTS member_key VARCHAR(512)')
    expect(syncA).toContain(
      'ADD COLUMN IF NOT EXISTS selected_company_ids JSONB'
    )
    expect(stripSqlComments(syncA)).not.toContain('SET NOT NULL')
    expect(stripSqlComments(syncA)).not.toContain('company_merge_pending_key')
    expect(syncB).toContain('UPDATE public.company_merge_suggestion')
    expect(stripSqlComments(syncB)).not.toContain('SET NOT NULL')
    expect(stripSqlComments(syncB)).not.toContain('CREATE TABLE')
    expect(syncC).toContain('ALTER COLUMN member_key SET NOT NULL')
    expect(syncC).toContain('ON DELETE RESTRICT')
    expect(syncC).toContain('ON UPDATE CASCADE')
    expect(syncC).not.toContain('ON UPDATE NO ACTION')
    expect(syncC).toContain('company_merge_suggestion_member_key_status_idx')
    expect(syncC).toContain('company_merge_suggestion_candidate_key_status_idx')
    expect(syncC).not.toMatch(/WHERE[\s\S]*UNIQUE/i)
    expect(stripSqlComments(syncC)).not.toMatch(/CREATE UNIQUE INDEX/i)
  })

  it('checks pending-key rows and rolls the columns back', async () => {
    const [postflight, rollback] = await Promise.all([
      readProjectFile(files.postflight),
      readProjectFile(files.rollback)
    ])
    expect(postflight).toContain('member_key must be NOT NULL')
    expect(postflight).toContain('ON DELETE RESTRICT')
    expect(postflight).toContain('confupdtype')
    expect(postflight).toContain("IS DISTINCT FROM 'c'")
    expect(postflight).toContain('pending suggestion without its pending-key')
    expect(rollback).toContain(
      'DROP TABLE IF EXISTS public.company_merge_pending_key'
    )
    expect(rollback).toContain('DROP COLUMN member_key')
    expect(rollback).toContain('DROP COLUMN candidate_key')
  })
})
