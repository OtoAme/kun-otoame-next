# Prisma Production Drift Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent production deploys from rebuilding `patch_released_idx` for Prisma 7.8's known operator-class false drift while continuing to fail closed on every other schema difference.

**Architecture:** A pure, dependency-injected guard classifies Prisma's documented `migrate diff --exit-code` results and validates the one approved exception against PostgreSQL catalog metadata. A thin CLI adapter runs Prisma and the read-only catalog query; production deploy commands use the guard plus client generation, while development and disposable CI databases retain `prisma db push`.

**Tech Stack:** TypeScript 5.8, Node.js 22.15+, Vitest 4, Prisma CLI 7.8, PostgreSQL 18 catalog queries, `pg` 8, pnpm/esno.

## Global Constraints

- Keep `prisma/schema/patch.prisma` and the PostgreSQL `patch_released_idx` definition unchanged.
- The guard must never execute database-changing SQL or print `KUN_DATABASE_URL`.
- Accept exit `0`, or exit `2` with only the exact known `patch_released_idx` drop/create SQL and a structurally valid live index.
- Reject every additional diff, altered SQL statement, Prisma error, database error, missing URL, missing index, duplicate catalog row, or invalid index state.
- Keep `pnpm prisma:push` and `.github/workflows/release.yml` unchanged for local/disposable CI initialization.
- Production schema changes must be applied by reviewed preflight/sync SQL before `deploy:pull` or `deploy:build`.
- Preserve `migration:resource-links` before production verification and run `prisma generate` only after verification succeeds.
- Use Conventional Commits and keep documentation/skill updates in a separate commit from code and tests.

---

### Task 1: Build the pure fail-closed drift guard with TDD

**Files:**

- Create: `scripts/prismaProductionSchemaGuard.ts`
- Create: `tests/unit/prisma-production-schema-guard.test.ts`

**Interfaces:**

- Consumes: Prisma CLI exit status/stdout supplied by a caller, plus catalog rows supplied only for the known exception.
- Produces: `KNOWN_RELEASED_PATTERN_INDEX_DIFF`, `classifyPrismaDiff`, `isExpectedReleasedPatternIndex`, `runPrismaProductionSchemaGuard`, and their supporting exported types.

- [ ] **Step 1: Write the failing guard tests**

Create `tests/unit/prisma-production-schema-guard.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import {
  KNOWN_RELEASED_PATTERN_INDEX_DIFF,
  classifyPrismaDiff,
  isExpectedReleasedPatternIndex,
  runPrismaProductionSchemaGuard,
  type ReleasedPatternIndexMetadata
} from '~/scripts/prismaProductionSchemaGuard'

const validIndex: ReleasedPatternIndexMetadata = {
  schema_name: 'public',
  table_name: 'patch',
  index_name: 'patch_released_idx',
  column_name: 'released',
  access_method: 'btree',
  operator_class: 'text_pattern_ops',
  key_attribute_count: 1,
  total_attribute_count: 1,
  is_unique: false,
  is_primary: false,
  is_valid: true,
  is_ready: true,
  is_live: true,
  has_no_predicate: true,
  has_no_expression: true
}

describe('classifyPrismaDiff', () => {
  it('accepts an empty diff exit', () => {
    expect(classifyPrismaDiff({ exitCode: 0, stdout: '' })).toBe('clean')
  })

  it('accepts only the known released pattern index false drift', () => {
    expect(
      classifyPrismaDiff({
        exitCode: 2,
        stdout: `\r\n${KNOWN_RELEASED_PATTERN_INDEX_DIFF.replaceAll('\n', '\r\n')}\r\n`
      })
    ).toBe('known-released-pattern-index')
  })

  it.each([
    `${KNOWN_RELEASED_PATTERN_INDEX_DIFF}\nDROP TABLE "patch";`,
    KNOWN_RELEASED_PATTERN_INDEX_DIFF.replace('text_pattern_ops', 'text_ops'),
    '-- DropIndex\nDROP INDEX "other_idx";'
  ])('rejects altered or additional SQL: %s', (stdout) => {
    expect(classifyPrismaDiff({ exitCode: 2, stdout })).toBe('unexpected')
  })

  it('rejects Prisma command errors', () => {
    expect(classifyPrismaDiff({ exitCode: 1, stdout: '' })).toBe('unexpected')
  })
})

describe('isExpectedReleasedPatternIndex', () => {
  it('accepts the exact live single-column pattern index', () => {
    expect(isExpectedReleasedPatternIndex(validIndex)).toBe(true)
  })

  it.each([
    { operator_class: 'text_ops' },
    { column_name: 'name' },
    { key_attribute_count: 2 },
    { total_attribute_count: 2 },
    { is_valid: false },
    { is_ready: false },
    { is_live: false },
    { has_no_predicate: false },
    { has_no_expression: false }
  ])('rejects mismatched metadata: %o', (change) => {
    expect(isExpectedReleasedPatternIndex({ ...validIndex, ...change })).toBe(
      false
    )
  })
})

describe('runPrismaProductionSchemaGuard', () => {
  it('does not query PostgreSQL for an empty diff', async () => {
    const loadIndexMetadata = vi.fn()

    await expect(
      runPrismaProductionSchemaGuard({
        runDiff: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
        loadIndexMetadata,
        log: vi.fn()
      })
    ).resolves.toBe('clean')
    expect(loadIndexMetadata).not.toHaveBeenCalled()
  })

  it('validates PostgreSQL metadata before accepting the known exception', async () => {
    const loadIndexMetadata = vi.fn().mockResolvedValue([validIndex])

    await expect(
      runPrismaProductionSchemaGuard({
        runDiff: async () => ({
          exitCode: 2,
          stdout: KNOWN_RELEASED_PATTERN_INDEX_DIFF,
          stderr: ''
        }),
        loadIndexMetadata,
        log: vi.fn()
      })
    ).resolves.toBe('known-released-pattern-index')
    expect(loadIndexMetadata).toHaveBeenCalledTimes(1)
  })

  it('fails closed for extra drift without querying PostgreSQL', async () => {
    const loadIndexMetadata = vi.fn()

    await expect(
      runPrismaProductionSchemaGuard({
        runDiff: async () => ({
          exitCode: 2,
          stdout: `${KNOWN_RELEASED_PATTERN_INDEX_DIFF}\n-- CreateTable`,
          stderr: ''
        }),
        loadIndexMetadata,
        log: vi.fn()
      })
    ).rejects.toThrow('Unexpected Prisma schema drift')
    expect(loadIndexMetadata).not.toHaveBeenCalled()
  })

  it.each([[], [validIndex, validIndex], [{ ...validIndex, is_valid: false }]])(
    'fails closed for invalid catalog rows: %o',
    async (rows) => {
      await expect(
        runPrismaProductionSchemaGuard({
          runDiff: async () => ({
            exitCode: 2,
            stdout: KNOWN_RELEASED_PATTERN_INDEX_DIFF,
            stderr: ''
          }),
          loadIndexMetadata: async () => rows,
          log: vi.fn()
        })
      ).rejects.toThrow('catalog validation failed')
    }
  )
})
```

- [ ] **Step 2: Run the target test and verify RED**

Run:

```bash
pnpm test tests/unit/prisma-production-schema-guard.test.ts
```

Expected: FAIL because `~/scripts/prismaProductionSchemaGuard` does not exist.

- [ ] **Step 3: Implement the minimal pure guard**

Create `scripts/prismaProductionSchemaGuard.ts`:

```ts
export const KNOWN_RELEASED_PATTERN_INDEX_DIFF = `-- DropIndex
DROP INDEX "patch_released_idx";

-- CreateIndex
CREATE INDEX "patch_released_idx" ON "patch"("released" text_pattern_ops);`

export type PrismaDiffResult = {
  exitCode: number | null
  stdout: string
  stderr: string
}

export type PrismaDiffClassification =
  | 'clean'
  | 'known-released-pattern-index'
  | 'unexpected'

export type ReleasedPatternIndexMetadata = {
  schema_name: string
  table_name: string
  index_name: string
  column_name: string
  access_method: string
  operator_class: string
  key_attribute_count: number
  total_attribute_count: number
  is_unique: boolean
  is_primary: boolean
  is_valid: boolean
  is_ready: boolean
  is_live: boolean
  has_no_predicate: boolean
  has_no_expression: boolean
}

type GuardDependencies = {
  runDiff: () => Promise<PrismaDiffResult>
  loadIndexMetadata: () => Promise<ReleasedPatternIndexMetadata[]>
  log: (message: string) => void
}

const normalizeDiff = (value: string) => value.replaceAll('\r\n', '\n').trim()

export const classifyPrismaDiff = (
  result: Pick<PrismaDiffResult, 'exitCode' | 'stdout'>
): PrismaDiffClassification => {
  if (result.exitCode === 0) return 'clean'
  if (
    result.exitCode === 2 &&
    normalizeDiff(result.stdout) === KNOWN_RELEASED_PATTERN_INDEX_DIFF
  ) {
    return 'known-released-pattern-index'
  }
  return 'unexpected'
}

export const isExpectedReleasedPatternIndex = (
  row: ReleasedPatternIndexMetadata
) =>
  row.schema_name === 'public' &&
  row.table_name === 'patch' &&
  row.index_name === 'patch_released_idx' &&
  row.column_name === 'released' &&
  row.access_method === 'btree' &&
  row.operator_class === 'text_pattern_ops' &&
  row.key_attribute_count === 1 &&
  row.total_attribute_count === 1 &&
  !row.is_unique &&
  !row.is_primary &&
  row.is_valid &&
  row.is_ready &&
  row.is_live &&
  row.has_no_predicate &&
  row.has_no_expression

export const runPrismaProductionSchemaGuard = async ({
  runDiff,
  loadIndexMetadata,
  log
}: GuardDependencies): Promise<
  Exclude<PrismaDiffClassification, 'unexpected'>
> => {
  const result = await runDiff()
  const classification = classifyPrismaDiff(result)

  if (classification === 'clean') {
    log('Prisma production schema guard: no drift detected.')
    return classification
  }

  if (classification === 'unexpected') {
    const suffix = result.exitCode === 2 ? `\n${result.stdout.trim()}` : ''
    throw new Error(
      `Unexpected Prisma schema drift or diff failure (exit ${String(result.exitCode)}).${suffix}`
    )
  }

  const rows = await loadIndexMetadata()
  if (rows.length !== 1 || !isExpectedReleasedPatternIndex(rows[0])) {
    throw new Error(
      'Known Prisma operator-class drift was reported, but patch_released_idx catalog validation failed.'
    )
  }

  log(
    'Prisma production schema guard: accepted the verified patch_released_idx operator-class introspection exception.'
  )
  return classification
}
```

- [ ] **Step 4: Run the target test and verify GREEN**

Run:

```bash
pnpm test tests/unit/prisma-production-schema-guard.test.ts
```

Expected: PASS with all guard tests green.

- [ ] **Step 5: Format and commit the guard core**

Run:

```bash
pnpm exec prettier --write scripts/prismaProductionSchemaGuard.ts tests/unit/prisma-production-schema-guard.test.ts
git diff --check
git add scripts/prismaProductionSchemaGuard.ts tests/unit/prisma-production-schema-guard.test.ts
git commit -m "feat(prisma): add production drift guard core"
```

Expected: formatting and diff checks pass; one Conventional Commit is created.

---

### Task 2: Add the real CLI adapter and wire production deploy paths

**Files:**

- Create: `scripts/checkPrismaProductionSchema.ts`
- Create: `tests/unit/prisma-production-deploy-command.test.ts`
- Modify: `package.json:7-20`
- Modify: `scripts/deployPull.ts:168-216`
- Modify: `scripts/deployBuild.ts:38-45`

**Interfaces:**

- Consumes: Task 1's `runPrismaProductionSchemaGuard` and `ReleasedPatternIndexMetadata`.
- Produces: executable `scripts/checkPrismaProductionSchema.ts` and package command `pnpm prisma:deploy-safe` used by both production deployment paths.

- [ ] **Step 1: Write the failing deployment integration test**

Create `tests/unit/prisma-production-deploy-command.test.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const readProjectFile = (path: string) =>
  readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

describe('production Prisma deployment command', () => {
  it('keeps development push and adds the fail-closed production command', async () => {
    const pkg = JSON.parse(await readProjectFile('package.json'))

    expect(pkg.scripts['prisma:push']).toBe(
      'pnpm migration:resource-links && pnpm prisma db push && pnpm prisma generate'
    )
    expect(pkg.scripts['prisma:deploy-safe']).toBe(
      'pnpm migration:resource-links && esno scripts/checkPrismaProductionSchema.ts && pnpm prisma generate'
    )
  })

  it('guards deploy pull before replacing the running standalone directory', async () => {
    const source = await readProjectFile('scripts/deployPull.ts')
    const guardPosition = source.indexOf("execSync('pnpm prisma:deploy-safe'")
    const replacementPosition = source.indexOf(
      "console.log('Applying atomic update...')"
    )

    expect(guardPosition).toBeGreaterThan(-1)
    expect(guardPosition).toBeLessThan(replacementPosition)
    expect(source).not.toContain("execSync('pnpm prisma:push'")
  })

  it('uses the safe command for server builds but leaves disposable CI push unchanged', async () => {
    const [build, release] = await Promise.all([
      readProjectFile('scripts/deployBuild.ts'),
      readProjectFile('.github/workflows/release.yml')
    ])

    expect(build).toContain('pnpm prisma:deploy-safe && pnpm build')
    expect(build).not.toContain('pnpm prisma:push && pnpm build')
    expect(release).toContain('run: pnpm prisma:push')
    expect(release).not.toContain('prisma:deploy-safe')
  })
})
```

- [ ] **Step 2: Run the integration test and verify RED**

Run:

```bash
pnpm test tests/unit/prisma-production-deploy-command.test.ts
```

Expected: FAIL because `prisma:deploy-safe` and the production guard calls do not exist.

- [ ] **Step 3: Implement the thin read-only CLI adapter**

Create `scripts/checkPrismaProductionSchema.ts`:

```ts
import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import pg from 'pg'
import {
  runPrismaProductionSchemaGuard,
  type PrismaDiffResult,
  type ReleasedPatternIndexMetadata
} from './prismaProductionSchemaGuard'

const projectRoot = resolve(import.meta.dirname, '..')

const INDEX_METADATA_QUERY = `
SELECT
  namespace.nspname AS schema_name,
  indexed_table.relname AS table_name,
  index_relation.relname AS index_name,
  indexed_column.attname AS column_name,
  access_method.amname AS access_method,
  operator_class.opcname AS operator_class,
  index_metadata.indnkeyatts AS key_attribute_count,
  index_metadata.indnatts AS total_attribute_count,
  index_metadata.indisunique AS is_unique,
  index_metadata.indisprimary AS is_primary,
  index_metadata.indisvalid AS is_valid,
  index_metadata.indisready AS is_ready,
  index_metadata.indislive AS is_live,
  index_metadata.indpred IS NULL AS has_no_predicate,
  index_metadata.indexprs IS NULL AS has_no_expression
FROM pg_index AS index_metadata
JOIN pg_class AS index_relation
  ON index_relation.oid = index_metadata.indexrelid
JOIN pg_class AS indexed_table
  ON indexed_table.oid = index_metadata.indrelid
JOIN pg_namespace AS namespace
  ON namespace.oid = indexed_table.relnamespace
JOIN pg_am AS access_method
  ON access_method.oid = index_relation.relam
JOIN pg_opclass AS operator_class
  ON operator_class.oid = index_metadata.indclass[0]
JOIN pg_attribute AS indexed_column
  ON indexed_column.attrelid = indexed_table.oid
  AND indexed_column.attnum = index_metadata.indkey[0]
WHERE namespace.nspname = 'public'
  AND indexed_table.relname = 'patch'
  AND index_relation.relname = 'patch_released_idx'
`

const runDiff = async (): Promise<PrismaDiffResult> => {
  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'prisma',
      'migrate',
      'diff',
      '--exit-code',
      '--from-config-datasource',
      '--to-schema=prisma/schema',
      '--script'
    ],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: process.env
    }
  )

  if (result.error) throw result.error
  return {
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  }
}

const loadIndexMetadata = async (): Promise<ReleasedPatternIndexMetadata[]> => {
  const connectionString = process.env.KUN_DATABASE_URL
  if (!connectionString) {
    throw new Error(
      'KUN_DATABASE_URL is required for production schema verification.'
    )
  }

  const pool = new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 5000
  })

  try {
    const result =
      await pool.query<ReleasedPatternIndexMetadata>(INDEX_METADATA_QUERY)
    return result.rows
  } finally {
    await pool.end()
  }
}

runPrismaProductionSchemaGuard({
  runDiff,
  loadIndexMetadata,
  log: console.log
}).catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : 'Unknown production schema verification failure.'
  )
  process.exitCode = 1
})
```

- [ ] **Step 4: Add `prisma:deploy-safe` without changing `prisma:push`**

Add this script beside the existing Prisma scripts in `package.json`:

```json
"prisma:deploy-safe": "pnpm migration:resource-links && esno scripts/checkPrismaProductionSchema.ts && pnpm prisma generate"
```

Do not modify the existing `prisma:push` value.

- [ ] **Step 5: Guard deploy pull before atomic standalone replacement**

In `scripts/deployPull.ts`, replace the current schema generation/injection
block with this sequence so verification happens before the running standalone
directory is replaced:

```ts
const hasReleasePrismaSchema = fs.existsSync(tempPrismaDir)

if (hasReleasePrismaSchema) {
  console.log('Updating Prisma schema...')
  if (fs.existsSync(rootPrismaDir)) {
    fs.rmSync(rootPrismaDir, { recursive: true, force: true })
  }
  fs.renameSync(tempPrismaDir, rootPrismaDir)
}

console.log('Verifying production database schema...')
execSync('pnpm prisma:deploy-safe', { stdio: 'inherit' })

if (hasReleasePrismaSchema) {
  console.log('Injecting generated Prisma Client into standalone build...')
  copyPackage('.prisma')
  copyPackage('@prisma')
}
```

The safe command now performs target-architecture client generation. Remove
the later block that logs `Running database migrations...` and calls
`pnpm prisma:push` after atomic replacement.

- [ ] **Step 6: Replace the server-build production command**

Change only the command string in `scripts/deployBuild.ts`:

```ts
'git pull && pnpm i && pnpm prisma:deploy-safe && pnpm build && pm2 startOrReload ecosystem.config.cjs'
```

- [ ] **Step 7: Run both target tests and verify GREEN**

Run:

```bash
pnpm test \
  tests/unit/prisma-production-schema-guard.test.ts \
  tests/unit/prisma-production-deploy-command.test.ts
pnpm typecheck
```

Expected: both test files pass and typecheck exits `0`.

- [ ] **Step 8: Format, inspect commands, and commit code/tests**

Run:

```bash
pnpm exec prettier --write \
  scripts/prismaProductionSchemaGuard.ts \
  scripts/checkPrismaProductionSchema.ts \
  tests/unit/prisma-production-schema-guard.test.ts \
  tests/unit/prisma-production-deploy-command.test.ts \
  scripts/deployPull.ts \
  scripts/deployBuild.ts \
  package.json
git diff --check
rg -n -C 2 "prisma:push|prisma:deploy-safe" \
  package.json scripts/deployPull.ts scripts/deployBuild.ts .github/workflows/release.yml
git add \
  scripts/prismaProductionSchemaGuard.ts \
  scripts/checkPrismaProductionSchema.ts \
  tests/unit/prisma-production-schema-guard.test.ts \
  tests/unit/prisma-production-deploy-command.test.ts \
  scripts/deployPull.ts \
  scripts/deployBuild.ts \
  package.json
git commit -m "fix(deploy): guard production Prisma drift"
```

Expected: production paths reference only `prisma:deploy-safe`; disposable CI
still references `prisma:push`; the code/test commit contains no docs or skill
files.

---

### Task 3: Verify the real guard and synchronize operations documentation

**Files:**

- Modify: `docs/project/deployment.md`
- Modify: `docs/project/development.md`
- Modify: `docs/modules/operations.md`
- Modify: `.codex/skills/otoame-deployment/SKILL.md`
- Modify: `.codex/skills/otoame-operations/SKILL.md`
- Modify: `.codex/skills/otoame-data-cache/SKILL.md`

**Interfaces:**

- Consumes: Task 2's `pnpm prisma:deploy-safe` and read-only CLI.
- Produces: consistent operator guidance stating that production deploy verifies pre-applied schema while development/CI can still push.

- [ ] **Step 1: Run the guard itself against the current database**

Run only the read-only adapter, not the package command that includes the
resource-link compatibility migration:

```bash
pnpm exec esno scripts/checkPrismaProductionSchema.ts
```

Expected: Prisma exits `2` with only the known false drift; catalog validation
accepts the live `public.patch_released_idx` and the command exits `0`. No DDL
or DML is executed.

- [ ] **Step 2: Re-run the raw diff to prove the guard did not mutate schema**

Run:

```bash
pnpm exec prisma migrate diff \
  --exit-code \
  --from-config-datasource \
  --to-schema=prisma/schema \
  --script
```

Expected: exit `2` with the same exact two statements. A changed/empty result
would mean the supposedly read-only guard altered the database and must block
completion.

- [ ] **Step 3: Update project documentation**

Document these exact rules in the three project/module guides:

```text
- `pnpm prisma:push` remains the development/disposable-CI initializer.
- `pnpm prisma:deploy-safe` is the production deploy command.
- Production preflight/sync SQL must run before deployment.
- The command performs no Prisma schema writes; it accepts only an empty diff
  or the catalog-verified `patch_released_idx` Prisma 7.8 exception.
- Any other drift aborts before build or standalone replacement.
- Do not run the proposed DROP INDEX / CREATE INDEX SQL; it recurs after the
  next introspection and can block writes.
```

Update command sequences in `docs/project/deployment.md` and
`docs/modules/operations.md` from `prisma:push` to `prisma:deploy-safe` only
for `deploy:pull` and `deploy:build`. Keep local setup, first install, and
GitHub Actions descriptions on `prisma:push`.

- [ ] **Step 4: Update deployment/data skills**

Add these enforceable rules to the listed skills:

```text
- Production deploy paths use `pnpm prisma:deploy-safe`; reviewed sync SQL
  must already be applied.
- Keep the operator-class exception exact and catalog-verified; never broaden
  it to ignore arbitrary Prisma diff output.
- Development and disposable CI may continue to use `pnpm prisma:push`.
```

- [ ] **Step 5: Format and commit docs/skills separately**

Run:

```bash
pnpm exec prettier --check \
  docs/project/deployment.md \
  docs/project/development.md \
  docs/modules/operations.md \
  .codex/skills/otoame-deployment/SKILL.md \
  .codex/skills/otoame-operations/SKILL.md \
  .codex/skills/otoame-data-cache/SKILL.md
git diff --check
git add \
  docs/project/deployment.md \
  docs/project/development.md \
  docs/modules/operations.md \
  .codex/skills/otoame-deployment/SKILL.md \
  .codex/skills/otoame-operations/SKILL.md \
  .codex/skills/otoame-data-cache/SKILL.md
git commit -m "docs(deploy): document Prisma drift guard"
```

Expected: docs and skills are the only files in this commit.

---

### Task 4: Final verification and independent review

**Files:**

- Verify only; do not create or modify production files unless review finds a defect.

**Interfaces:**

- Consumes: all prior tasks and the approved design spec.
- Produces: fresh evidence that the guard is fail-closed, production paths use it, CI remains unchanged, and the repository builds.

- [ ] **Step 1: Run focused and full automated verification**

Run:

```bash
pnpm test \
  tests/unit/prisma-production-schema-guard.test.ts \
  tests/unit/prisma-production-deploy-command.test.ts
pnpm test
pnpm typecheck
pnpm build
```

Expected: all commands exit `0`; focused tests show zero failures, the full
suite shows zero failures, typecheck is clean, and the production standalone
build/postbuild completes.

- [ ] **Step 2: Run real read-only database verification again**

Run:

```bash
pnpm exec esno scripts/checkPrismaProductionSchema.ts
```

Expected: the exact verified exception is accepted and the command exits `0`.

- [ ] **Step 3: Inspect repository state and commit boundaries**

Run:

```bash
git diff --check
git status --short --branch
git log -4 --oneline
```

Expected: clean worktree; separate design, code/test, and docs/skills commits.

- [ ] **Step 4: Request an independent code review**

Provide the reviewer with:

```text
Requirements:
- Exact SQL allowlist only.
- Catalog validation of one live public.patch.released text_pattern_ops B-tree.
- No DB writes and no connection URL logging.
- Every other drift/error fails closed.
- Production deploy paths use the guard before replacement/build.
- Development/CI prisma:push remains unchanged.
Review Critical, Important, and Minor findings; verify target tests and
typecheck independently.
```

Expected: no unresolved Critical or Important findings. Fix any valid finding
with a new regression test and repeat the relevant verification before final
handoff.
