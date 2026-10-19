import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const sql = (kind: string) =>
  readFileSync(
    `migration/production-link-maintenance-${kind}-2026-10-19.sql`,
    'utf8'
  )
describe('link maintenance production migration contract', () => {
  it.each(['preflight', 'postflight'])(
    '%s is independently read only and guards existing health CHECK',
    (kind) => {
      const text = sql(kind)
      expect(text).toContain('BEGIN TRANSACTION READ ONLY')
      expect(text).not.toMatch(
        /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\s+(?:INTO|TABLE|INDEX|public\.)/i
      )
      expect(text).toContain('share_blocked')
      expect(text).toContain('invalid_latest_context')
    }
  )
  it('installs additively and re-runs without changing real events, old health cases or clocks', () => {
    const text = sql('sync')
    expect(text).toContain("SET LOCAL lock_timeout = '5s'")
    expect(text).toMatch(/BEGIN;[\s\S]*COMMIT;/)
    expect(text).toContain(
      'ON CONFLICT (original_link_id,link_version) DO NOTHING'
    )
    expect(text).toContain("'migrated'")
    expect(text).not.toMatch(
      /(?:UPDATE|DELETE FROM|ALTER TABLE)\s+(?:public\.)?(?:ops_case|patch_resource_link_check|patch_resource_link_report)\b/i
    )
    expect(text).not.toContain('INSERT INTO user_message')
    expect(text).not.toContain(
      'patch_resource_link_maintenance_resource_id_fkey'
    )
    expect(text).toContain('JOIN inserted_controls m ON m.id=e.control_id')
  })
  it('backfills only a latest strict current context and qualified untouched publisher case', () => {
    const text = sql('sync')
    for (const predicate of [
      "kind='link_suspect'",
      'c.first_owner_response_at IS NULL',
      "c.owner_type='publisher'",
      'ORDER BY created DESC,id DESC LIMIT 1',
      'report.ever_counted=true AND report.weight>0',
      "ctx.context->'linkVersion'=to_jsonb(l.version)",
      "ctx.context->'evidenceRound'=to_jsonb(l.evidence_round)",
      'jsonb_object_keys',
      'link_maintenance_event_round_key',
      'active_key_key'
    ])
      expect(text).toContain(predicate)
  })
})
