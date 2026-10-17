import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  LINK_CHECK_PROVIDERS,
  LINK_CHECK_REASONS,
  LINK_HEALTH_STATES
} from '~/constants/linkHealth'

const read = (path: string) =>
  readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
const migration = (phase: string) =>
  read(`migration/production-link-health-blocked-${phase}-2026-10-17.sql`)
const executable = (sql: string) => sql.replace(/--.*$/gm, '')
const literal = (sql: string, tag: string) => {
  const delimiter = `$${tag}$`
  const parts = sql.split(delimiter)
  expect(parts, tag).toHaveLength(3)
  return parts[1]
}
const definitions = (sql: string) => {
  const old = literal(sql, 'old_check')
  const before = literal(sql, 'old_reason')
  const after = literal(sql, 'new_reason')
  expect(old.split(before)).toHaveLength(2)
  expect(sql).toMatch(
    /new_definition CONSTANT text := replace\(old_definition,\s*\$old_reason\$/
  )
  return { old, next: old.replace(before, after) }
}
const values = (sql: string) =>
  [...sql.matchAll(/'([^']+)'::character varying/g)].map((match) => match[1])
const arrayFor = (definition: string, column: string) => {
  const start = definition.indexOf(`((${column})::text = ANY ((ARRAY[`)
  expect(start, column).toBeGreaterThanOrEqual(0)
  return values(definition.slice(start).split(']')[0])
}

describe('blocked link checks can be persisted without weakening snapshot validity', () => {
  it('adds only share_blocked to the exact historical CHECK and matches shared allowed values', async () => {
    const historical = await read(
      'migration/production-link-health-sync-2026-10-09.sql'
    )
    const match = historical.match(
      /\('patch_resource_link_check', 'link_check_shape_check', '((?:''|[^'])*)'\)/
    )
    expect(match).not.toBeNull()
    const old = match![1].replace(/''/g, "'")
    expect(old).not.toContain('share_blocked')
    const next = old.replace(
      "'share_expired'::character varying]",
      "'share_expired'::character varying, 'share_blocked'::character varying]"
    )
    for (const phase of ['preflight', 'sync', 'postflight']) {
      const actual = definitions(await migration(phase))
      expect(actual.old, phase).toBe(old)
      expect(actual.next, phase).toBe(next)
      expect(arrayFor(actual.next, 'provider')).toEqual([...LINK_CHECK_PROVIDERS])
      expect(arrayFor(actual.next, 'health')).toEqual([...LINK_HEALTH_STATES])
      const reasons = [
        ...actual.next.matchAll(
          /\(\(reason\)::text = '([^']+)'::text\)|\(\(reason\)::text = ANY \(\(ARRAY\[([^\]]+)\]/g
        )
      ].flatMap((entry) => (entry[1] ? [entry[1]] : values(entry[2])))
      expect(reasons.sort(), phase).toEqual([...LINK_CHECK_REASONS].sort())
      const broken = actual.next.split("(verdict)::text = 'broken'::text")[1]
      expect(arrayFor(broken, 'reason')).toEqual([
        'share_deleted',
        'share_cancelled',
        'share_expired',
        'share_blocked'
      ])
    }
  })

  it('uses the historical CHECK DDL with only share_blocked added when installing the new constraint', async () => {
    const historical = await read(
      'migration/production-link-health-sync-2026-10-09.sql'
    )
    const original = historical.match(
      /ALTER TABLE public\.patch_resource_link_check ADD CONSTRAINT link_check_shape_check (CHECK [^\n]+); END IF; END \$add_check\$;/
    )
    expect(original).not.toBeNull()
    const oldReasons =
      "reason IN ('share_deleted', 'share_cancelled', 'share_expired')"
    expect(original![1].split(oldReasons)).toHaveLength(2)
    const expected = original![1].replace(
      oldReasons,
      "reason IN ('share_deleted', 'share_cancelled', 'share_expired', 'share_blocked')"
    )
    const sql = await migration('sync')
    const added = sql.match(
      /ADD CONSTRAINT link_check_shape_check (CHECK [\s\S]+?) NOT VALID;/
    )
    expect(added).not.toBeNull()
    expect(added![1]).toBe(expected)
    const reasons = [
      ...added![1].matchAll(/\breason (?:= '([^']+)'|IN \(([^)]+)\))/g)
    ].flatMap((entry) =>
      entry[1]
        ? [entry[1]]
        : [...entry[2].matchAll(/'([^']+)'/g)].map((value) => value[1])
    )
    expect(reasons.sort()).toEqual([...LINK_CHECK_REASONS].sort())
    expect(sql).not.toMatch(/\bEXECUTE\b/)
  })

  it('keeps preflight and postflight strictly read-only with explicit rejection of missing or malformed objects', async () => {
    for (const phase of ['preflight', 'postflight']) {
      const sql = executable(await migration(phase))
      expect(sql).toMatch(/BEGIN TRANSACTION READ ONLY;/)
      expect(sql.trim()).toMatch(/COMMIT;$/)
      expect(sql).not.toMatch(
        /\b(CREATE|ALTER|DROP|INSERT|DELETE|UPDATE|TRUNCATE|LOCK)\b/i
      )
    }
    for (const phase of ['preflight', 'sync', 'postflight']) {
      const sql = executable(await migration(phase))
      expect(sql, phase).toContain('missing table public.patch_resource_link_check')
      expect(sql, phase).toContain('missing CHECK link_check_shape_check')
      expect(sql, phase).toContain('incompatible CHECK link_check_shape_check')
      expect(sql, phase).toContain("relkind = 'r'")
      expect(sql, phase).toContain("conname = 'link_check_shape_check'")
      expect(sql, phase).toContain('pg_get_constraintdef(oid, false)')
      for (const metadata of [
        "actual.contype <> 'c'",
        'NOT actual.convalidated',
        'NOT actual.conenforced',
        'actual.connoinherit',
        'actual.condeferrable',
        'actual.condeferred',
        'NOT actual.conislocal',
        'actual.coninhcount <> 0',
        'actual.conparentid <> 0'
      ]) {
        expect(sql, `${phase}: ${metadata}`).toContain(metadata)
      }
      expect(sql).not.toMatch(/\b(LIKE|ILIKE|WHEN OTHERS)\b/i)
    }
  })

  it('accepts exactly the old or new definition before sync and only the new definition after it', async () => {
    for (const phase of ['preflight', 'sync']) {
      expect(await migration(phase), phase).toContain(
        'actual.definition NOT IN (old_definition, new_definition)'
      )
    }
    const postflight = await migration('postflight')
    expect(postflight).toContain('actual.definition IS DISTINCT FROM new_definition')
    expect(postflight).not.toContain('NOT IN (old_definition, new_definition)')
  })

  it('locks before inspection, replaces only the exact old CHECK, and validates within one bounded transaction', async () => {
    const sql = executable(await migration('sync'))
    expect(sql.trim()).toMatch(/^\\set ON_ERROR_STOP on\s+BEGIN;/)
    expect(sql.trim()).toMatch(/COMMIT;$/)
    expect(sql.match(/^BEGIN;/gm)).toHaveLength(1)
    expect(sql.match(/^COMMIT;/gm)).toHaveLength(1)
    expect(sql).toContain("SET LOCAL lock_timeout = '5s';")
    expect(sql).toContain("SET LOCAL statement_timeout = '60s';")
    const lock = sql.indexOf(
      'LOCK TABLE public.patch_resource_link_check IN ACCESS EXCLUSIVE MODE;'
    )
    const inspect = sql.indexOf('pg_get_constraintdef(oid, false)')
    const guard = sql.indexOf('IF actual.definition = old_definition THEN')
    const drop = sql.indexOf(
      'ALTER TABLE public.patch_resource_link_check DROP CONSTRAINT link_check_shape_check;'
    )
    const add = sql.indexOf(
      'ALTER TABLE public.patch_resource_link_check ADD CONSTRAINT link_check_shape_check '
    )
    const validate = sql.indexOf(
      'ALTER TABLE public.patch_resource_link_check VALIDATE CONSTRAINT link_check_shape_check;'
    )
    expect(lock).toBeGreaterThan(0)
    expect(inspect).toBeGreaterThan(lock)
    expect(guard).toBeGreaterThan(inspect)
    expect(drop).toBeGreaterThan(guard)
    expect(add).toBeGreaterThan(drop)
    expect(validate).toBeGreaterThan(add)
    expect(sql).toContain(' NOT VALID;')
    expect(sql.indexOf('actual.definition IS DISTINCT FROM new_definition')).toBeGreaterThan(validate)
    expect(sql.match(/DROP CONSTRAINT/g)).toHaveLength(1)
    expect(sql.match(/ADD CONSTRAINT/g)).toHaveLength(1)
    expect(sql).not.toMatch(/\b(INSERT|DELETE|UPDATE|TRUNCATE|CREATE|DROP TABLE|CASCADE)\b/i)
    expect(sql).not.toContain('IF EXISTS')
  })
})
