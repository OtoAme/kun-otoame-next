import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const readProjectFile = (path: string) =>
  readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

const preflightPath =
  'migration/production-patch-submission-preflight-2026-08-24.sql'
const syncPath = 'migration/production-patch-submission-sync-2026-08-24.sql'

const stripSqlComments = (sql: string) =>
  sql.replaceAll(/--.*$/gm, '').replaceAll(/\/\*[\s\S]*?\*\//g, '')

describe('production patch submission migration', () => {
  it('keeps the preflight read-only and skips row checks for missing tables', async () => {
    const preflight = await readProjectFile(preflightPath)
    const executableSql = stripSqlComments(preflight)

    expect(preflight).toContain('\\set ON_ERROR_STOP on')
    expect(preflight).toContain('BEGIN TRANSACTION READ ONLY')
    expect(preflight).toMatch(
      /to_regclass\('public\.patch_submission'\)[\s\S]*AS patch_submission_exists[\s\S]*\\gset[\s\S]*\\if :patch_submission_exists[\s\S]*FROM public\.patch_submission[\s\S]*skipped_missing_table[\s\S]*\\endif/
    )
    expect(preflight).toMatch(
      /to_regclass\('public\.patch_submission_gallery'\)[\s\S]*AS patch_submission_gallery_exists[\s\S]*\\gset[\s\S]*\\if :patch_submission_gallery_exists[\s\S]*FROM public\.patch_submission_gallery[\s\S]*skipped_missing_table[\s\S]*\\endif/
    )
    expect(executableSql).not.toMatch(
      /\b(CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\b/i
    )
  })

  it('keeps the sync idempotent and verifies the required tables', async () => {
    const sync = await readProjectFile(syncPath)

    expect(sync).toContain('CREATE TABLE IF NOT EXISTS public.patch_submission')
    expect(sync).toContain(
      'CREATE TABLE IF NOT EXISTS public.patch_submission_gallery'
    )
    expect(sync).not.toMatch(
      /\bupdated\s+TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/
    )
    expect(sync).toMatch(
      /ALTER TABLE public\.patch_submission\s+ALTER COLUMN updated DROP DEFAULT/
    )
    expect(sync).toMatch(
      /ALTER TABLE public\.patch_submission_gallery\s+ALTER COLUMN updated DROP DEFAULT/
    )
    expect(sync).toContain('invalid_updated_defaults')
    expect(sync).toContain('patch_submission postflight failed')
  })

  it('reports database defaults that conflict with Prisma updatedAt', async () => {
    const preflight = await readProjectFile(preflightPath)

    expect(preflight).toContain("'updated_default' AS check_type")
    expect(preflight).toContain("('patch_submission', 'updated')")
    expect(preflight).toContain("('patch_submission_gallery', 'updated')")
    expect(preflight).toContain("'unexpected_default'")
  })
})
