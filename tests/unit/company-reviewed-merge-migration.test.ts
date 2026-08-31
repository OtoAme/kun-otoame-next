import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migrationPath =
  'migration/production-company-reviewed-merge-2026-08-31.sql'

describe('reviewed production company merge migration', () => {
  it('is dry-run by default and commits only with an explicit APPLY value', async () => {
    const sql = await readFile(migrationPath, 'utf8')

    expect(sql).toContain('\\if :{?APPLY}')
    expect(sql).toContain('\\if :APPLY')
    expect(sql).toContain('Reviewed company merge committed (APPLY=1)')
    expect(sql).toContain(
      'Reviewed company merge dry-run complete; rolled back (APPLY was not set)'
    )
  })

  it('locks all company state and delegates counts exclusively to triggers', async () => {
    const sql = await readFile(migrationPath, 'utf8')

    expect(sql).toContain(
      'LOCK TABLE public.patch_company_relation IN SHARE ROW EXCLUSIVE MODE'
    )
    expect(sql).toContain(
      'LOCK TABLE public.patch_company IN SHARE ROW EXCLUSIVE MODE'
    )
    expect(sql).toContain(
      'LOCK TABLE public.patch_company_external_id IN SHARE ROW EXCLUSIVE MODE'
    )
    expect(sql).toContain(
      'LOCK TABLE public.patch_company_name_identity IN SHARE ROW EXCLUSIVE MODE'
    )
    expect(sql).toContain("'patch_company_count_trg_ins'")
    expect(sql).toContain("'patch_company_count_trg_del'")
    expect(sql).toContain("'patch_company_count_trg_upd'")
    expect(sql).not.toMatch(
      /UPDATE\s+public\.patch_company[\s\S]*?SET\s+count\s*=/i
    )
  })

  it('contains only the seven reviewed merge directions', async () => {
    const sql = await readFile(migrationPath, 'utf8')
    const expectedPairs = [
      [249, 324],
      [28, 378],
      [325, 400],
      [300, 301],
      [397, 395],
      [88, 321],
      [238, 417]
    ]

    for (const [targetId, sourceId] of expectedPairs) {
      expect(sql).toContain(`(${targetId}, ${sourceId},`)
    }

    expect(sql).toContain('expected 406 companies')
    expect(sql).toContain('expected 24 identity rows')
    expect(sql).toContain('expected to remove 7 companies')
    expect(sql).toContain('expected 399 companies')
    expect(sql).toContain('normalized name collision groups=%')
  })
})
