import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const readProjectFile = (path: string) =>
  readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

const bootstrapPreflightPath =
  'migration/production-resource-access-bootstrap-preflight-2026-07-12.sql'
const bootstrapSyncPath =
  'migration/production-resource-access-bootstrap-sync-2026-07-12.sql'

const stripSqlComments = (sql: string) =>
  sql.replaceAll(/--.*$/gm, '').replaceAll(/\/\*[\s\S]*?\*\//g, '')

describe('resource access bootstrap production migration', () => {
  it('stays manual and fail-closed', async () => {
    const [preflight, sync, pkg, deployPull, deployBuild, release] =
      await Promise.all([
        readProjectFile(bootstrapPreflightPath),
        readProjectFile(bootstrapSyncPath),
        readProjectFile('package.json'),
        readProjectFile('scripts/deployPull.ts'),
        readProjectFile('scripts/deployBuild.ts'),
        readProjectFile('.github/workflows/release.yml')
      ])

    expect(preflight).toContain('\\set ON_ERROR_STOP on')
    expect(sync).toContain('\\set ON_ERROR_STOP on')
    expect(preflight).toContain('BEGIN TRANSACTION READ ONLY')
    expect(sync).toContain("SET LOCAL lock_timeout = '5s'")
    expect(sync).not.toContain('\\ir')

    for (const automaticSource of [pkg, deployPull, deployBuild, release]) {
      expect(automaticSource).not.toContain(
        'production-resource-access-bootstrap-sync-2026-07-12.sql'
      )
    }
  })

  it('locks the exact Phase 2 table, sequence, constraint, and index contract', async () => {
    const [preflight, sync] = await Promise.all([
      readProjectFile(bootstrapPreflightPath),
      readProjectFile(bootstrapSyncPath)
    ])
    const combined = `${preflight}\n${sync}`

    for (const contract of [
      'patch_resource_access_id_seq',
      'patch_resource_access_pkey',
      'patch_resource_access_user_id_fkey',
      'patch_resource_access_patch_id_fkey',
      'patch_resource_access_resource_id_fkey',
      'patch_resource_access_link_id_fkey',
      'patch_resource_access_user_id_link_id_expires_idx',
      'patch_resource_access_visitor_token_link_id_expires_idx',
      'patch_resource_access_patch_id_created_idx',
      'patch_resource_access_resource_id_created_idx',
      'patch_resource_access_link_id_created_idx',
      'pg_get_serial_sequence',
      "format('nextval(%L::regclass)'",
      'pg_depend',
      'indisprimary',
      'indisunique',
      'indisready',
      'indisvalid',
      'indislive'
    ]) {
      expect(combined).toContain(contract)
    }

    expect(sync).toMatch(
      /updated\s+timestamp\(3\)\s+without time zone\s+NOT NULL[,\n]/i
    )
    expect(sync).not.toMatch(/updated[^,;]*DEFAULT\s+CURRENT_TIMESTAMP/i)
    expect(stripSqlComments(sync)).not.toMatch(
      /^\s*(DROP|DELETE|UPDATE|INSERT)\b/im
    )
  })

  it('classifies Phase 2 and every supported grant migration interruption state', async () => {
    const [preflight, sync] = await Promise.all([
      readProjectFile(bootstrapPreflightPath),
      readProjectFile(bootstrapSyncPath)
    ])
    const combined = `${preflight}\n${sync}`

    for (const state of [
      'ready_to_create',
      'phase2_present',
      'upgrade_compatible_present'
    ]) {
      expect(combined).toContain(state)
    }

    for (const grantObject of [
      'patch_resource_access_grant',
      'patch_resource_access_grant_pkey',
      'resource_access_grant_expires_idx',
      'resource_access_visitor_kind_created_idx'
    ]) {
      expect(preflight).toContain(grantObject)
    }

    expect(preflight).toContain('invalid_not_ready_or_not_live')
    expect(preflight).toContain('ready_valid_live_definition_mismatch')
    expect(preflight).toContain('same_name_non_index')
  })

  it('repairs interrupted Steam index creation and verifies the result', async () => {
    const [preflight, sync] = await Promise.all([
      readProjectFile(
        'migration/production-steam-id-soft-duplicate-preflight-2026-07-09.sql'
      ),
      readProjectFile(
        'migration/production-steam-id-soft-duplicate-sync-2026-07-09.sql'
      )
    ])

    for (const metadata of ['indisready', 'indisvalid', 'indislive']) {
      expect(preflight).toContain(metadata)
      expect(sync).toContain(metadata)
    }
    expect(sync).toContain('DROP INDEX CONCURRENTLY')
    expect(sync).toContain('steam_id index postflight failed')
    expect(sync).toContain('con.conkey = ARRAY[steam_attnum]')
    expect(sync).toContain('Unknown standalone steam_id indexes')
    expect(sync).toContain("index_row.indrelid = to_regclass('public.patch')")
    expect(sync).toContain('index_row.indkey[0]')
    expect(sync).toContain('index_row.indpred IS NULL')
    expect(sync).toContain('index_row.indexprs IS NULL')
    expect(sync).not.toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS')
  })

  it('documents the manual bootstrap, fixed release tag, and recovery gate', async () => {
    const requiredBootstrapSources = [
      'README.md',
      'docs/project/deployment.md',
      'docs/modules/operations.md',
      'docs/modules/data-cache-upload.md',
      'docs/project/testing.md',
      'docs/project/review.md',
      '.codex/skills/otoame-data-cache/SKILL.md',
      '.codex/skills/otoame-operations/SKILL.md',
      '.codex/skills/otoame-deployment/SKILL.md',
      '.codex/skills/otoame-testing/SKILL.md',
      '.codex/skills/otoame-review/SKILL.md'
    ]

    for (const path of requiredBootstrapSources) {
      const source = await readProjectFile(path)
      expect(source, path).toContain(
        'production-resource-access-bootstrap-preflight-2026-07-12.sql'
      )
    }

    for (const path of [
      'README.md',
      'docs/project/deployment.md',
      'docs/modules/operations.md',
      '.codex/skills/otoame-deployment/SKILL.md'
    ]) {
      const source = await readProjectFile(path)
      expect(source, path).toContain('KUN_DEPLOY_RELEASE_TAG')
    }

    const deployment = await readProjectFile('docs/project/deployment.md')
    expect(deployment).toContain('不得重启旧 Release')
    expect(deployment).not.toContain(
      'pnpm prisma:push 代替 resource access bootstrap'
    )
  })
})
