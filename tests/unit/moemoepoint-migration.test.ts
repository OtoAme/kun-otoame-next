import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const readProjectFile = (path: string) =>
  readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

describe('moemoepoint production migration', () => {
  it('keeps preflight read-only and sync idempotent', async () => {
    const [preflight, sync] = await Promise.all([
      readProjectFile(
        'migration/production-moemoepoint-ledger-preflight-2026-08-17.sql'
      ),
      readProjectFile(
        'migration/production-moemoepoint-ledger-sync-2026-08-17.sql'
      )
    ])

    expect(preflight).toContain('BEGIN TRANSACTION READ ONLY')
    expect(preflight).not.toMatch(
      /^\s*(ALTER|CREATE|DROP|INSERT|UPDATE|DELETE)\b/im
    )
    expect(preflight).toContain('pg_total_relation_size')
    expect(sync).toContain('ADD COLUMN IF NOT EXISTS moemoepoint_reserved')
    expect(sync).toContain(
      'CREATE TABLE IF NOT EXISTS public.user_moemoepoint_ledger'
    )
    expect(sync).toContain(
      'CREATE TABLE IF NOT EXISTS public.user_moemoepoint_reservation'
    )
    expect(sync).toContain('ON CONFLICT (idempotency_key) DO NOTHING')
    expect(sync).toContain("'moemoepoint:opening:' || id")
  })

  it('locks cascade, balance, status, and query index contracts', async () => {
    const sync = await readProjectFile(
      'migration/production-moemoepoint-ledger-sync-2026-08-17.sql'
    )

    for (const contract of [
      'ON DELETE CASCADE ON UPDATE CASCADE',
      'user_moemoepoint_reserved_nonnegative',
      'user_moemoepoint_reservation_amount_positive',
      'user_moemoepoint_reservation_status_valid',
      'user_moemoepoint_ledger_kind_valid',
      'user_moemoepoint_ledger_user_id_created_id_idx',
      'user_status_moemoepoint_id_idx'
    ]) {
      expect(sync).toContain(contract)
    }
  })
})
