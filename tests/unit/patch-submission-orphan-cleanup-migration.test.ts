import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const readProjectFile = (path: string) =>
  readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

const preflightPath =
  'migration/production-patch-submission-orphan-cleanup-preflight-2026-08-25.sql'
const syncPath =
  'migration/production-patch-submission-orphan-cleanup-sync-2026-08-25.sql'

const stripSqlComments = (sql: string) =>
  sql.replaceAll(/--.*$/gm, '').replaceAll(/\/\*[\s\S]*?\*\//g, '')

describe('production patch submission orphan cleanup migration', () => {
  it('keeps preflight read-only', async () => {
    const preflight = stripSqlComments(await readProjectFile(preflightPath))

    expect(preflight).toContain('patch_submission_orphan_cleanup')
    expect(preflight).toMatch(/SELECT/i)
    expect(preflight).not.toMatch(
      /\b(CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\b/i
    )
  })

  it('creates an idempotent durable job table with the required guards', async () => {
    const sync = await readProjectFile(syncPath)

    expect(sync).toContain(
      'CREATE TABLE IF NOT EXISTS public.patch_submission_orphan_cleanup'
    )
    expect(sync).toMatch(/object_key\s+VARCHAR\(1007\) NOT NULL/)
    expect(sync).toMatch(/purge_urls\s+JSONB NOT NULL/)
    expect(sync).toMatch(/attempts\s+INTEGER NOT NULL DEFAULT 0/)
    expect(sync).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS patch_submission_orphan_cleanup_object_key_key'
    )
    expect(sync).toContain(
      'CREATE INDEX IF NOT EXISTS patch_submission_orphan_cleanup_created_id_idx'
    )
    expect(sync).toContain('patch_submission_orphan_cleanup_key_prefix')
    expect(sync).toContain("object_key LIKE 'patch-submission/%'")
    expect(sync).toContain('patch_submission_orphan_cleanup_attempts_nonnegative')
    expect(sync).toContain('CHECK (attempts >= 0)')
    expect(sync).toContain('patch_submission_orphan_cleanup postflight failed')
    expect(sync).not.toMatch(/FOREIGN KEY/i)
  })

  it('keeps Prisma schema aligned with the production table', async () => {
    const schema = await readProjectFile('prisma/schema/patch-submission.prisma')

    expect(schema).toContain('model patch_submission_orphan_cleanup')
    expect(schema).toContain('object_key String @unique @db.VarChar(1007)')
    expect(schema).toContain('purge_urls Json')
    expect(schema).toContain('@@index([created, id])')
  })
})
