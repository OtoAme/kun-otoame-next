import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
const read = (path: string) =>
  readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
const migration = (phase: string) =>
  read(`migration/production-link-health-${phase}-2026-10-09.sql`)
const executable = (sql: string) =>
  sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

describe('link-health upgrade preserves authorization and real evidence', () => {
  it('keeps inventory and both postflight modes read-only', async () => {
    for (const phase of ['preflight', 'postflight']) {
      const sql = await migration(phase)
      expect(sql).toContain('BEGIN TRANSACTION READ ONLY')
      expect(executable(sql)).not.toMatch(
        /\b(CREATE|ALTER|DROP|INSERT|DELETE|UPDATE|TRUNCATE)\b/i
      )
    }
    const postflight = await migration('postflight')
    expect(postflight).toContain('\\if :initial_baseline')
    expect(postflight).toContain('\\set initial_baseline false')
  })

  it('uses bounded, pre-guarded DDL without backfilling unknown acquisitions or resetting health', async () => {
    const sql = await migration('sync')
    expect(sql).toContain("SET LOCAL lock_timeout = '5s'")
    expect(sql).toContain("SET LOCAL statement_timeout = '60s'")
    expect(executable(sql)).not.toMatch(
      /^\s*(UPDATE|INSERT|DELETE|TRUNCATE)\b/im
    )
    expect(sql.indexOf('incompatible access link FK/nullability')).toBeLessThan(
      sql.indexOf('ADD COLUMN IF NOT EXISTS')
    )
    expect(sql).toMatch(/"link_version" INTEGER[,;]/)
    expect(sql).toMatch(/"version" INTEGER NOT NULL DEFAULT 1/)
    expect(sql).not.toMatch(/"link_version"[^,;]*DEFAULT/)
    expect(sql).not.toContain('DROP TABLE')
  })

  it('keeps resource cascade while single-link deletion sets the event FK to null', async () => {
    const schema = await read('prisma/schema/patch-resource.prisma')
    expect(schema).toMatch(/link_id\s+Int\?/)
    expect(schema).toMatch(
      /link\s+patch_resource_link\?[^\n]*onDelete: SetNull, onUpdate: NoAction/
    )
    expect(schema).toMatch(/resource\s+patch_resource[^\n]*onDelete: Cascade/)
    expect(await migration('sync')).toContain(
      'ON DELETE SET NULL ON UPDATE NO ACTION'
    )
  })

  it('rejects incompatible table, FK, CHECK and index objects instead of silently retaining them', async () => {
    for (const phase of ['preflight', 'sync', 'postflight']) {
      const sql = await migration(phase)
      for (const guard of [
        'incompatible table',
        'incompatible column',
        'incompatible FK',
        'incompatible CHECK',
        'incompatible index',
        'indisready',
        'indisvalid',
        'indislive',
        'convalidated',
        'indnullsnotdistinct',
        'pg_get_serial_sequence'
      ]) {
        expect(sql, phase).toContain(guard)
      }
    }
  })

  it('keeps history slot identity after link removal and distinguishes health-only audit rows', async () => {
    const schema = await read('prisma/schema/patch-resource-link-health.prisma')
    const history = schema
      .split('model patch_resource_link_history {')[1]
      .split('model patch_resource_link_check')[0]
    expect(history).not.toMatch(/references: \[id\].*patch_resource_link/)
    expect(history).toContain('health_transition Json?')
    expect(history).toMatch(/health_event_key\s+String\?\s+@unique/)
    expect(await migration('sync')).toContain('link_history_shape_check')
    expect(await migration('postflight')).toContain('old_content IS NULL')
  })
})
