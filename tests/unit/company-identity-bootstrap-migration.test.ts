import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const readProjectFile = (path: string) =>
  readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

const preflightPath =
  'migration/production-company-identity-bootstrap-preflight-2026-08-30.sql'
const syncPath =
  'migration/production-company-identity-bootstrap-sync-2026-08-30.sql'
const postflightPath =
  'migration/production-company-identity-bootstrap-postflight-2026-08-30.sql'

const stripSqlComments = (sql: string) =>
  sql.replaceAll(/--.*$/gm, '').replaceAll(/\/\*[\s\S]*?\*\//g, '')

describe('production company identity bootstrap migration', () => {
  it('keeps preflight and postflight read-only while distinguishing missing targets from incompatible objects', async () => {
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

    expect(preflight).toContain('ready_to_create')
    expect(preflight).toContain('definition_mismatch')
    expect(preflight).toContain('company identity bootstrap preflight failed')
    expect(postflight).toContain('company identity bootstrap postflight failed')
  })

  it('creates the Phase A columns, tables, indexes, and referential actions idempotently', async () => {
    const sync = await readProjectFile(syncPath)

    expect(sync).toContain('\\set ON_ERROR_STOP on')
    expect(sync).toContain('BEGIN;')
    expect(sync).toContain('COMMIT;')
    expect(sync).toContain("SET LOCAL lock_timeout = '5s'")
    expect(sync).toContain(
      'ADD COLUMN IF NOT EXISTS normalized_name VARCHAR(107)'
    )
    expect(sync).toContain('ADD COLUMN IF NOT EXISTS company_candidates JSONB')
    expect(sync).toContain(
      'CREATE TABLE IF NOT EXISTS public.patch_company_external_id'
    )
    expect(sync).toContain(
      'CREATE TABLE IF NOT EXISTS public.patch_company_name_identity'
    )
    expect(sync).toContain('ON DELETE CASCADE ON UPDATE NO ACTION')
    expect(sync).toContain('ON DELETE SET NULL ON UPDATE NO ACTION')
    expect(sync).not.toMatch(/updated[^,;]*DEFAULT\s+CURRENT_TIMESTAMP/i)

    const executableSql = stripSqlComments(sync)
    expect(executableSql).not.toMatch(/^\s*(TRUNCATE|DELETE|UPDATE)\b/im)
    expect(executableSql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b/i)
  })

  it('keeps the two global identities non-unique during Phase A', async () => {
    const sync = await readProjectFile(syncPath)

    expect(sync).toMatch(
      /CREATE INDEX IF NOT EXISTS patch_company_normalized_name_idx/
    )
    expect(sync).toMatch(
      /CREATE INDEX IF NOT EXISTS patch_company_external_id_source_external_id_idx/
    )
    expect(sync).not.toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS patch_company_normalized_name/i
    )
    expect(sync).not.toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS patch_company_external_id_source_external_id/i
    )
    expect(sync).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS patch_company_name_identity_company_kind_value_key'
    )
  })

  it('locks the Prisma schema relations and the independent postflight contract', async () => {
    const [companySchema, submissionSchema, userSchema, postflight] =
      await Promise.all([
        readProjectFile('prisma/schema/patch-company.prisma'),
        readProjectFile('prisma/schema/patch-submission.prisma'),
        readProjectFile('prisma/schema/user.prisma'),
        readProjectFile(postflightPath)
      ])

    for (const model of [
      'model patch_company_external_id',
      'model patch_company_name_identity'
    ]) {
      expect(companySchema).toContain(model)
    }
    expect(submissionSchema).toContain('company_candidates Json?')
    expect(userSchema).toContain(
      'confirmed_company_identities patch_company_name_identity[] @relation("patch_company_identity_confirmer")'
    )

    for (const contract of [
      'patch_company_normalized_name_idx',
      'patch_company_external_id_source_external_id_idx',
      'patch_company_name_identity_company_kind_value_key',
      'patch_company_external_id_company_id_fkey',
      'patch_company_name_identity_company_id_fkey',
      'patch_company_name_identity_confirmed_by_user_id_fkey',
      'unexpected_global_unique',
      'unexpected_updated_default'
    ]) {
      expect(postflight).toContain(contract)
    }
  })
})
