import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const readProjectFile = (path: string) =>
  readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

const prefix = 'migration/production-company-identity-constraint'
const paths = {
  preflight: `${prefix}-preflight-2026-08-30.sql`,
  sync: `${prefix}-sync-2026-08-30.sql`,
  postflight: `${prefix}-postflight-2026-08-30.sql`,
  rollback: `${prefix}-rollback-2026-08-30.sql`,
  rollbackPostflight: `${prefix}-rollback-postflight-2026-08-30.sql`
}

const stripSqlComments = (sql: string) =>
  sql.replaceAll(/--.*$/gm, '').replaceAll(/\/\*[\s\S]*?\*\//g, '')

describe('production company identity Phase B constraints', () => {
  it('keeps preflight and postflight read-only while separating blockers from legal shared aliases', async () => {
    const [preflight, postflight] = await Promise.all([
      readProjectFile(paths.preflight),
      readProjectFile(paths.postflight)
    ])

    for (const sql of [preflight, postflight]) {
      expect(sql).toContain('\\set ON_ERROR_STOP on')
      expect(sql).toContain('BEGIN TRANSACTION READ ONLY')
      expect(stripSqlComments(sql)).not.toMatch(
        /\b(CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\b/i
      )
    }

    expect(preflight).toContain("'missing_normalized_name' AS check_type")
    expect(preflight).toContain("'normalized_name_collision' AS check_type")
    expect(preflight).toContain("'external_identity_collision' AS check_type")
    expect(preflight).toContain("'shared_alias' AS check_type")
    expect(preflight).toContain("'warning' AS status")
    expect(preflight).not.toMatch(/shared_alias[\s\S]{0,500}RAISE EXCEPTION/i)
  })

  it('adds not-null and the two Prisma-native unique indexes only after all blockers pass', async () => {
    const sync = await readProjectFile(paths.sync)
    const executable = stripSqlComments(sync)

    const readinessIndex = sync.indexOf('DO $ready$')
    const notNullIndex = sync.indexOf(
      'ALTER COLUMN normalized_name SET NOT NULL'
    )
    const normalizedUniqueIndex = sync.indexOf(
      'CREATE UNIQUE INDEX IF NOT EXISTS patch_company_normalized_name_key'
    )
    const externalUniqueIndex = sync.indexOf(
      'CREATE UNIQUE INDEX IF NOT EXISTS patch_company_external_id_source_external_id_key'
    )
    expect(readinessIndex).toBeGreaterThan(0)
    expect(notNullIndex).toBeGreaterThan(readinessIndex)
    expect(normalizedUniqueIndex).toBeGreaterThan(notNullIndex)
    expect(externalUniqueIndex).toBeGreaterThan(normalizedUniqueIndex)

    expect(sync).toContain('missing normalized names=%')
    expect(sync).toContain('normalized name collision groups=%')
    expect(sync).toContain('external identity collision groups=%')
    expect(sync).toContain(
      'DROP INDEX IF EXISTS public.patch_company_normalized_name_idx'
    )
    expect(sync).toContain(
      'DROP INDEX IF EXISTS public.patch_company_external_id_source_external_id_idx'
    )
    expect(executable).not.toMatch(
      /\b(DROP TABLE|TRUNCATE|DELETE|INSERT|UPDATE)\b/i
    )
  })

  it('locks the final Prisma schema and retry constraint names', async () => {
    const [schema, retry] = await Promise.all([
      readProjectFile('prisma/schema/patch-company.prisma'),
      readProjectFile('app/api/company/identity/retry.ts')
    ])

    expect(schema).toMatch(
      /normalized_name\s+String\s+@unique\s+@db\.VarChar\(107\)/
    )
    expect(schema).toContain('@@unique([source, external_id])')
    expect(schema).not.toContain('@@index([normalized_name])')
    expect(schema).not.toContain('@@index([source, external_id])')
    expect(retry).toContain('patch_company_normalized_name_key')
    expect(retry).toContain('patch_company_external_id_source_external_id_key')
  })

  it('postflight verifies exact indexes, removes Phase A indexes, and leaves shared aliases as warnings', async () => {
    const postflight = await readProjectFile(paths.postflight)

    for (const index of [
      'patch_company_normalized_name_key',
      'patch_company_external_id_source_external_id_key',
      'patch_company_normalized_name_idx',
      'patch_company_external_id_source_external_id_idx'
    ]) {
      expect(postflight).toContain(index)
    }
    expect(postflight).toContain('index_row.indisunique')
    expect(postflight).toContain('index_row.indpred IS NULL')
    expect(postflight).toContain('index_row.indexprs IS NULL')
    expect(postflight).toContain("'shared_alias' AS check_type")
    expect(postflight).toContain("'warning' AS status")
  })

  it('rolls Phase B back to the nullable Phase A query-index contract without deleting identity data', async () => {
    const [rollback, rollbackPostflight] = await Promise.all([
      readProjectFile(paths.rollback),
      readProjectFile(paths.rollbackPostflight)
    ])
    const executable = stripSqlComments(rollback)

    expect(rollback).toContain('BEGIN;')
    expect(rollback).toContain('COMMIT;')
    expect(rollback).toContain('ALTER COLUMN normalized_name DROP NOT NULL')
    expect(rollback).toContain(
      'CREATE INDEX IF NOT EXISTS patch_company_normalized_name_idx'
    )
    expect(rollback).toContain(
      'CREATE INDEX IF NOT EXISTS patch_company_external_id_source_external_id_idx'
    )
    expect(rollback).toContain(
      'DROP INDEX IF EXISTS public.patch_company_normalized_name_key'
    )
    expect(rollback).toContain(
      'DROP INDEX IF EXISTS public.patch_company_external_id_source_external_id_key'
    )
    expect(executable).not.toMatch(
      /\b(DROP TABLE|TRUNCATE|DELETE|INSERT|UPDATE)\b/i
    )

    expect(rollbackPostflight).toContain('BEGIN TRANSACTION READ ONLY')
    expect(rollbackPostflight).toContain("is_nullable = 'YES'")
    expect(rollbackPostflight).toContain('Phase B unique indexes remain')
    expect(rollbackPostflight).toContain("'company_candidates', 'jsonb'")
    expect(rollbackPostflight).toContain(
      'patch_company_name_identity_confirmed_by_user_id_fkey'
    )
    expect(rollbackPostflight).toContain(
      'patch_company_name_identity_company_kind_value_key'
    )
    for (const sql of [rollback, rollbackPostflight]) {
      expect(sql).toContain("access_method.amname = 'btree'")
      expect(sql).toContain("operator_class.opcname = 'text_ops'")
      expect(sql).toContain("source_operator_class.opcname = 'text_ops'")
      expect(sql).toContain("external_operator_class.opcname = 'text_ops'")
    }
    expect(stripSqlComments(rollbackPostflight)).not.toMatch(
      /\b(CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\b/i
    )
  })
})
