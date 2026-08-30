import { readFile } from 'node:fs/promises'
import { globby } from 'globby'
import { describe, expect, it } from 'vitest'

const readProjectFile = (path: string) =>
  readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

const migrationPrefix = 'migration/production-tag-company-count'
const paths = {
  preflight: `${migrationPrefix}-preflight-2026-08-30.sql`,
  sync: `${migrationPrefix}-sync-2026-08-30.sql`,
  postflight: `${migrationPrefix}-postflight-2026-08-30.sql`,
  rollback: `${migrationPrefix}-rollback-2026-08-30.sql`
}

const stripSqlComments = (sql: string) =>
  sql.replaceAll(/--.*$/gm, '').replaceAll(/\/\*[\s\S]*?\*\//g, '')

const triggerNames = [
  'patch_tag_count_trg_ins',
  'patch_tag_count_trg_del',
  'patch_tag_count_trg_upd',
  'patch_company_count_trg_ins',
  'patch_company_count_trg_del',
  'patch_company_count_trg_upd'
]

describe('production tag/company count migration', () => {
  it('keeps inventory and verification read-only while only structural conflicts block preflight', async () => {
    const [preflight, postflight] = await Promise.all([
      readProjectFile(paths.preflight),
      readProjectFile(paths.postflight)
    ])

    for (const sql of [preflight, postflight]) {
      expect(sql).toContain('\\set ON_ERROR_STOP on')
      expect(sql).toContain('BEGIN TRANSACTION READ ONLY')
      const executableSql = stripSqlComments(sql).replaceAll(
        /\$source\$[\s\S]*?\$source\$/g,
        ''
      )
      expect(executableSql).not.toMatch(
        /\b(CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\b/i
      )
    }

    expect(preflight).toContain("'counter_drift' AS check_type")
    expect(preflight).toContain('max_absolute_delta')
    expect(preflight).toContain('required integer column mismatch')
    expect(preflight).toContain('cannot be safely replaced')
    expect(preflight).not.toMatch(/counter_drift[\s\S]{0,400}RAISE EXCEPTION/i)
    expect(postflight).toContain('count mismatches=%')
  })

  it('installs all six statement-level transition-table triggers before one locked absolute backfill', async () => {
    const sync = await readProjectFile(paths.sync)

    expect(sync).toContain('BEGIN;')
    expect(sync).toContain('COMMIT;')
    expect(sync.match(/CREATE OR REPLACE FUNCTION public\./g)).toHaveLength(6)
    expect(sync.match(/CREATE TRIGGER patch_/g)).toHaveLength(6)
    expect(sync).not.toContain('FOR EACH ROW')
    expect(sync).toContain('REFERENCING NEW TABLE AS new_rows')
    expect(sync).toContain('REFERENCING OLD TABLE AS old_rows')
    expect(sync).toContain(
      'REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows'
    )
    expect(sync).toContain('old_row.tag_id IS DISTINCT FROM new_row.tag_id')
    expect(sync).toContain(
      'old_row.company_id IS DISTINCT FROM new_row.company_id'
    )

    for (const name of triggerNames) {
      expect(sync).toContain(`DROP TRIGGER IF EXISTS ${name}`)
      expect(sync).toContain(`CREATE TRIGGER ${name}`)
      expect(sync).toContain(`FUNCTION public.${name}()`)
    }

    const lockIndex = sync.indexOf(
      'LOCK TABLE public.patch_tag_relation, public.patch_company_relation IN SHARE MODE'
    )
    const tagBackfillIndex = sync.indexOf('UPDATE public.patch_tag parent')
    const companyBackfillIndex = sync.indexOf(
      'UPDATE public.patch_company parent'
    )
    expect(lockIndex).toBeGreaterThan(0)
    expect(tagBackfillIndex).toBeGreaterThan(lockIndex)
    expect(companyBackfillIndex).toBeGreaterThan(tagBackfillIndex)
  })

  it('verifies function bodies, trigger catalogs, events, transition tables, and both invariants', async () => {
    const postflight = await readProjectFile(paths.postflight)

    for (const name of triggerNames) {
      expect(postflight).toContain(name)
    }
    expect(postflight).toContain('pg_get_functiondef')
    expect(postflight).toContain('pg_get_triggerdef')
    expect(postflight).toContain('function_row.prosrc')
    expect(postflight).toContain('trigger_row.tgtype')
    expect(postflight).toContain('trigger_row.tgoldtable')
    expect(postflight).toContain('trigger_row.tgnewtable')
    expect(postflight).toContain("trigger_row.tgenabled <> 'O'")
    expect(postflight).toContain("'patch_tag' AS parent_table")
    expect(postflight).toContain("'patch_company'")
  })

  it('rolls back only owned trigger objects and repairs both counters under one lock', async () => {
    const rollback = await readProjectFile(paths.rollback)
    const executable = stripSqlComments(rollback)

    for (const name of triggerNames) {
      expect(rollback).toContain(`DROP TRIGGER IF EXISTS ${name}`)
      expect(rollback).toContain(`DROP FUNCTION IF EXISTS public.${name}()`)
    }
    expect(executable.match(/DROP TRIGGER IF EXISTS/g)).toHaveLength(6)
    expect(executable.match(/DROP FUNCTION IF EXISTS/g)).toHaveLength(6)
    expect(executable).toContain(
      'LOCK TABLE public.patch_tag_relation, public.patch_company_relation IN SHARE MODE'
    )
    expect(
      executable.match(/UPDATE public\.patch_(?:tag|company) parent/g)
    ).toHaveLength(2)
    expect(executable).not.toMatch(/\b(DROP TABLE|TRUNCATE|DELETE|INSERT)\b/i)
  })

  it('keeps application and TypeScript maintenance paths free of manual tag/company deltas', async () => {
    const files = await globby([
      'app/**/*.{ts,tsx}',
      'scripts/**/*.{ts,tsx}',
      'migration/**/*.{ts,tsx}',
      '!migration/backup/**'
    ])
    const violations: string[] = []
    const prismaDelta =
      /patch_(?:tag|company)\.(?:update|updateMany)\([\s\S]{0,500}?count\s*:\s*\{\s*(?:increment|decrement)/m
    const prismaAbsoluteRepair =
      /patch_(?:tag|company)\.(?:update|updateMany)\([\s\S]{0,500}?count\s*:\s*(?:actualCount|actual_count)/m
    const rawDelta =
      /UPDATE\s+"?patch_(?:tag|company)"?[\s\S]{0,300}?SET\s+"?count"?\s*=/im

    for (const file of files) {
      const source = await readFile(file, 'utf8')
      if (
        prismaDelta.test(source) ||
        prismaAbsoluteRepair.test(source) ||
        rawDelta.test(source)
      ) {
        violations.push(file)
      }
    }

    expect(violations).toEqual([])
  })
})
