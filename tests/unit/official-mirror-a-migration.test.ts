import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')
const migration = (name: string) => read(`migration/${name}`)

describe('official mirror schema contract', () => {
  const resource = read('prisma/schema/patch-resource.prisma')
  const mirror = read('prisma/schema/official-mirror.prisma')
  const guard = read('scripts/prismaProductionSchemaGuard.ts')

  it('stores handover, attachment, clicks, backup state, and scalar merge pairs', () => {
    expect(resource).toContain('publisher_left_at DateTime?')
    expect(resource).toContain('attached_at        DateTime  @default(now())')
    expect(resource).toContain('click              Int       @default(0)')
    expect(mirror).toContain('model patch_resource_backup_state')
    expect(mirror).toContain('onDelete: Cascade')
    expect(mirror).toContain('ignored_by_user_id     Int?')
    expect(mirror).not.toContain('ignored_by_user ')
    expect(mirror).toContain(
      '@@unique([user_resource_id, staff_resource_id], map: "patch_resource_merge_record_pair_key")'
    )
    expect(mirror).toContain(
      '@@index([staff_resource_id, status], map: "patch_resource_merge_record_staff_status_idx")'
    )
    expect(mirror).not.toMatch(/@@unique\([\s\S]*where:/)
    expect(mirror).not.toContain('user_resource    patch_resource')
    expect(mirror).not.toContain('staff_resource   patch_resource')
    expect(guard).toContain('patch_released_idx')
    expect(guard).not.toContain('patch_resource_merge_record')
  })

  it('keeps cleanup and merge rows when a resource disappears, and cascades only backup state', () => {
    const cleanup = mirror.slice(
      mirror.indexOf('model patch_resource_file_cleanup'),
      mirror.indexOf('model patch_resource_link_attached_at_fill')
    )
    const merge = mirror.slice(
      mirror.indexOf('model patch_resource_merge_record'),
      mirror.indexOf('model patch_resource_file_cleanup')
    )
    expect(cleanup).toContain('resource_id      Int')
    expect(cleanup).not.toContain('@relation')
    expect(cleanup).toContain('object_key       String   @unique')
    expect(cleanup).not.toContain('claim_version')
    expect(cleanup).not.toContain('delete_dispatched')
    expect(cleanup).not.toContain('delete_etag')
    expect(cleanup).not.toContain('storage_result')
    expect(merge).not.toContain('@relation')
    expect(merge).not.toContain('onDelete')
    expect(mirror).toContain(
      'patch_resource @relation(fields: [resource_id], references: [id], onDelete: Cascade, onUpdate: NoAction)'
    )
  })
})

describe('official mirror migration contract', () => {
  const preflight = migration(
    'production-official-mirror-preflight-2026-11-04.sql'
  )
  const sync = migration('production-official-mirror-sync-2026-11-04.sql')
  const postflight = migration(
    'production-official-mirror-postflight-2026-11-04.sql'
  )
  const correction = migration(
    'production-official-mirror-attached-at-correct-2026-11-04.sql'
  )
  const files = [preflight, sync, postflight, correction]

  it('requires an explicit decision and never treats a large group as a stamp by itself', () => {
    for (const file of [sync, correction]) {
      expect(file).toContain(":'stamp_confirmed'")
      expect(file).toContain(":'stamp_rejected'")
      expect(file).toContain(":'small_stamp_review'")
      expect(file).toContain("review IS DISTINCT FROM 'acknowledged'")
      expect(file).toContain('count(*) > 50')
      expect(file).toContain('BEGIN;')
      expect(file).toContain('COMMIT;')
    }
    expect(sync).not.toContain('claim_version')
    expect(sync).not.toContain('delete_dispatched')
    expect(sync).not.toContain('delete_etag')
    expect(sync).not.toContain('storage_result')
    expect(sync).toContain('WHERE link.attached_at IS NULL')
    expect(sync).toContain('ON CONFLICT (link_id) DO NOTHING')
    expect(sync).toContain('ALTER COLUMN attached_at SET NOT NULL')
    expect(sync).toContain('ALTER COLUMN attached_at SET DEFAULT CURRENT_TIMESTAMP')
    expect(sync).not.toMatch(/UPDATE\s+public\.patch_resource\b/i)
    expect(correction).toContain('attached_at = previous_value')
    expect(correction).toContain('skipped_changed_rows')
    expect(correction).not.toMatch(/SET\s+attached_at\s*=\s*NULL/i)
    for (const file of files) {
      expect(file).not.toContain('1159')
      expect(file).not.toMatch(/moemoepoint/i)
      expect(file).not.toMatch(/CREATE\s+UNIQUE\s+INDEX[\s\S]{0,200}WHERE\s+/i)
    }
  })

  it('keeps preflight and postflight read only and reports the observed stamp count', () => {
    for (const file of [preflight, postflight]) {
      expect(file).toContain('BEGIN TRANSACTION READ ONLY')
      expect(file).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP)\b/i)
    }
    expect(preflight).toContain('stamp_candidate')
    expect(preflight).toContain('count(*) > 50 AS stamp_candidate')
    expect(postflight).toContain('confirmed_stamp_links')
    expect(postflight).toContain(
      'publisher_left_at must be nullable timestamp(3) without time zone and have no default'
    )
    expect(postflight).toContain('merge records must not reference resources')
    expect(postflight).toContain('backup state must cascade')
    expect(postflight).toContain('partial unique indexes')
  })
})
