import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const readProjectFile = (path: string) =>
  readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

const preflightPath = 'migration/production-case-preflight-2026-09-13.sql'
const syncPath = 'migration/production-case-sync-2026-09-13.sql'
const postflightPath = 'migration/production-case-postflight-2026-09-13.sql'

const stripSqlComments = (sql: string) =>
  sql.replaceAll(/--.*$/gm, '').replaceAll(/\/\*[\s\S]*?\*\//g, '')

describe('production case migration contract', () => {
  it('keeps preflight and postflight read-only', async () => {
    const [preflight, postflight] = await Promise.all([
      readProjectFile(preflightPath),
      readProjectFile(postflightPath)
    ])

    for (const sql of [preflight, postflight]) {
      expect(sql).toContain('\\set ON_ERROR_STOP on')
      expect(sql).toContain('BEGIN TRANSACTION READ ONLY')
      expect(sql).toContain('COMMIT')
      expect(stripSqlComments(sql)).not.toMatch(
        /\b(CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\b/i
      )
    }
  })

  it('records the legacy feedback and patch-report cutover baselines', async () => {
    const preflight = stripSqlComments(await readProjectFile(preflightPath))

    expect(preflight).toMatch(
      /COUNT\(\*\)::bigint\s+AS row_count[\s\S]*FROM public\.user_message\s+WHERE type = 'feedback'/i
    )
    expect(preflight).toMatch(
      /COUNT\(\*\)::bigint\s+AS row_count[\s\S]*FROM public\.patch_report/i
    )
  })

  it('uses a bounded, add-only transactional sync and rejects partial tables', async () => {
    const sync = stripSqlComments(await readProjectFile(syncPath))

    expect(sync).toContain("SET LOCAL lock_timeout = '5s'")
    expect(sync).toContain("SET LOCAL statement_timeout = '60s'")
    expect(sync).toContain('BEGIN;')
    expect(sync).toContain('COMMIT;')
    expect(sync).toContain('case sync refused: public.% is partial or incompatible')
    expect(sync).not.toMatch(/ALTER TABLE public\.ops_case[\s\S]*ALTER COLUMN/i)
    expect(sync).not.toMatch(/\b(DROP|TRUNCATE|INSERT INTO|UPDATE public|DELETE FROM)\b/i)

    for (const tableName of [
      'ops_case',
      'ops_case_message',
      'ops_case_subscriber'
    ]) {
      expect(sync).toContain(`CREATE TABLE IF NOT EXISTS public.${tableName}`)
    }
  })

  it('matches the case schema columns and defaults', async () => {
    const sync = stripSqlComments(await readProjectFile(syncPath))
    const normalizedSync = sync.replace(/\s+/g, ' ')

    for (const column of [
      'kind VARCHAR(32) NOT NULL',
      'target_type VARCHAR(16) NOT NULL',
      'target_id INTEGER NOT NULL',
      'patch_id INTEGER',
      'reporter_id INTEGER',
      'owner_type VARCHAR(16) NOT NULL',
      'owner_id INTEGER',
      "status VARCHAR(20) NOT NULL DEFAULT 'open'",
      'resolution VARCHAR(32)',
      'public                  BOOLEAN NOT NULL DEFAULT FALSE',
      "source                  VARCHAR(16) NOT NULL DEFAULT 'user'",
      'dedup_key               VARCHAR(96)',
      'daily_key               VARCHAR(96)',
      'revision                INTEGER NOT NULL DEFAULT 0',
      'status_changed_at       TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP',
      'queue_entered_at        TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP',
      'closed_at               TIMESTAMP(3) WITHOUT TIME ZONE',
      'escalated_at            TIMESTAMP(3) WITHOUT TIME ZONE',
      'first_owner_response_at TIMESTAMP(3) WITHOUT TIME ZONE',
      'hidden_at               TIMESTAMP(3) WITHOUT TIME ZONE',
      'restored_at             TIMESTAMP(3) WITHOUT TIME ZONE',
      'reopened_count          INTEGER NOT NULL DEFAULT 0',
      'created                 TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP',
      'updated                 TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL',
      "kind      VARCHAR(8) NOT NULL DEFAULT 'reply'",
      'event     VARCHAR(24)',
      'payload   JSONB',
      'body      VARCHAR(5007) NOT NULL',
      'case_id INTEGER NOT NULL',
      'user_id INTEGER NOT NULL'
    ]) {
      expect(normalizedSync).toContain(column.replace(/\s+/g, ' '))
    }

    expect(sync).toContain(
      'CONSTRAINT ops_case_subscriber_case_id_user_id_key UNIQUE (case_id, user_id)'
    )
  })

  it('keeps every foreign-key target and Prisma delete/update action', async () => {
    const sync = stripSqlComments(await readProjectFile(syncPath))

    for (const contract of [
      [
        'ops_case_patch_id_fkey',
        'public.patch(id)',
        'ON DELETE SET NULL'
      ],
      [
        'ops_case_reporter_id_fkey',
        'public."user"(id)',
        'ON DELETE SET NULL'
      ],
      [
        'ops_case_owner_id_fkey',
        'public."user"(id)',
        'ON DELETE SET NULL'
      ],
      [
        'ops_case_message_case_id_fkey',
        'public.ops_case(id)',
        'ON DELETE CASCADE'
      ],
      [
        'ops_case_message_author_id_fkey',
        'public."user"(id)',
        'ON DELETE SET NULL'
      ],
      [
        'ops_case_subscriber_case_id_fkey',
        'public.ops_case(id)',
        'ON DELETE CASCADE'
      ],
      [
        'ops_case_subscriber_user_id_fkey',
        'public."user"(id)',
        'ON DELETE CASCADE'
      ]
    ] as const) {
      const [name, target, deleteAction] = contract
      expect(sync).toContain(`ADD CONSTRAINT ${name}`)
      expect(sync).toContain(`REFERENCES ${target}`)
      expect(sync).toContain(deleteAction)
      expect(sync).toContain('ON UPDATE NO ACTION')
    }
  })

  it('creates nullable ordinary unique indexes and all declared lookup indexes', async () => {
    const sync = stripSqlComments(await readProjectFile(syncPath))
    const postflight = stripSqlComments(await readProjectFile(postflightPath))

    for (const indexName of [
      'ops_case_dedup_key_key',
      'ops_case_daily_key_key',
      'ops_case_status_status_changed_at_idx',
      'ops_case_owner_type_owner_id_status_status_changed_at_idx',
      'ops_case_reporter_id_created_idx',
      'ops_case_target_type_target_id_status_idx',
      'ops_case_patch_id_status_idx',
      'ops_case_message_case_id_id_idx',
      'ops_case_message_case_id_created_id_idx',
      'ops_case_subscriber_case_id_user_id_key',
      'ops_case_subscriber_user_id_created_idx'
    ]) {
      expect(sync).toContain(`CREATE ${indexName.endsWith('_key') ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${indexName}`)
      expect(postflight).toContain(`'${indexName}'`)
    }

    expect(sync).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS ops_case_dedup_key_key\n  ON public.ops_case (dedup_key)'
    )
    expect(sync).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS ops_case_daily_key_key\n  ON public.ops_case (daily_key)'
    )
    expect(postflight).toContain('index_row.indpred IS NULL')
    expect(postflight).toContain('index_actual.indpred IS NOT NULL')
    expect(postflight).toContain('index_actual.indnatts <> index_actual.indnkeyatts')
    expect(postflight).toContain('source columns mismatch')
  })

  it('postflight checks defaults, index state, and referential action codes', async () => {
    const postflight = await readProjectFile(postflightPath)

    for (const contract of [
      'information_schema.columns',
      'datetime_precision',
      'column_default',
      'pg_get_indexdef',
      'indisunique',
      'indisprimary',
      'indisvalid',
      'indisready',
      'indislive',
      'indkey',
      'pg_get_constraintdef',
      'convalidated',
      'confmatchtype',
      'confdeltype',
      'confupdtype',
      'conkey',
      'confkey'
    ]) {
      expect(postflight).toContain(contract)
    }

    for (const constraintName of [
      'ops_case_patch_id_fkey',
      'ops_case_reporter_id_fkey',
      'ops_case_owner_id_fkey',
      'ops_case_message_case_id_fkey',
      'ops_case_message_author_id_fkey',
      'ops_case_subscriber_case_id_fkey',
      'ops_case_subscriber_user_id_fkey'
    ]) {
      expect(postflight).toContain(`'${constraintName}'`)
    }
  })

  it('rejects incompatible preexisting target objects before sync DDL', async () => {
    const [preflight, sync] = await Promise.all([
      readProjectFile(preflightPath),
      readProjectFile(syncPath)
    ])

    for (const sql of [preflight, sync]) {
      expect(sql).toContain('index_actual.indrelid')
    }

    expect(preflight).toContain('index_actual.indrelid IS DISTINCT FROM to_regclass')
    expect(preflight).toContain('actual_columns IS DISTINCT FROM index_contract.expected_columns')
    expect(preflight).toContain('constraint_actual.confdeltype::text <> constraint_contract.delete_action')
    expect(preflight).toContain('constraint_actual.confupdtype::text <> constraint_contract.update_action')

    expect(sync).toContain('index_actual.indrelid IS DISTINCT FROM to_regclass')
    expect(sync).toContain('actual_columns IS DISTINCT FROM index_contract.expected_columns')
    expect(sync).toContain('constraint_actual.confdeltype::text <> constraint_contract.delete_action')
    expect(sync).toContain('constraint_actual.confupdtype::text <> constraint_contract.update_action')

    const guardPosition = sync.indexOf('DO $existing_target_guard$')
    const firstTableDdlPosition = sync.indexOf('CREATE TABLE IF NOT EXISTS')
    expect(guardPosition).toBeGreaterThanOrEqual(0)
    expect(firstTableDdlPosition).toBeGreaterThan(guardPosition)
  })

  it('rejects NULLS NOT DISTINCT on the nullable unique keys', async () => {
    const [preflight, sync, postflight] = await Promise.all([
      readProjectFile(preflightPath),
      readProjectFile(syncPath),
      readProjectFile(postflightPath)
    ])

    for (const sql of [preflight, sync, postflight]) {
      expect(sql).toContain('indnullsnotdistinct')
    }
    expect(preflight).toContain('index_actual.indnullsnotdistinct IS NOT FALSE')
    expect(sync).toContain('index_actual.indnullsnotdistinct IS NOT FALSE')
    expect(postflight).toContain('index_actual.indnullsnotdistinct IS NOT FALSE')
    expect(postflight).toContain('index_row.indnullsnotdistinct')
  })
})
