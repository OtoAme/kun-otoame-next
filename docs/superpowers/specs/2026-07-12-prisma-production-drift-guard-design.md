# Prisma Production Drift Guard Design

## Context

Prisma 7.8 introspects the valid PostgreSQL index
`patch_released_idx` as a plain `@@index([released])`, dropping the explicit
`text_pattern_ops` representation from the database side of schema diffing.
`prisma migrate diff` therefore proposes dropping and recreating the index with
the same definition on every run.

The index is intentional. Release-date filters use prefix queries and the
database uses a non-`C` collation, so replacing it with an ordinary B-tree
without also redesigning and testing those queries would weaken the query
plan. Running the proposed SQL does not resolve the drift because the next
introspection loses the operator class again.

Production deployment currently calls `pnpm prisma:push`, so the false drift
can cause an unnecessary non-concurrent index rebuild. Development and GitHub
Actions still need `prisma:push` to initialize disposable databases.

## Decision

Add a fail-closed, read-only production schema guard and use it only from the
two production update paths.

The guard runs:

```bash
pnpm exec prisma migrate diff \
  --exit-code \
  --from-config-datasource \
  --to-schema=prisma/schema \
  --script
```

It accepts exactly two outcomes:

1. Prisma exits `0`, meaning there is no schema diff.
2. Prisma exits `2` and stdout, after line-ending normalization and outer
   whitespace trimming, is exactly:

   ```sql
   -- DropIndex
   DROP INDEX "patch_released_idx";

   -- CreateIndex
   CREATE INDEX "patch_released_idx" ON "patch"("released" text_pattern_ops);
   ```

The second outcome is accepted only after a parameter-free PostgreSQL catalog
query proves all of the following:

- schema `public`, table `patch`, index `patch_released_idx`;
- one key column named `released`;
- B-tree access method and `text_pattern_ops` operator class;
- non-unique, non-primary, non-partial, non-expression index;
- `indisvalid`, `indisready`, and `indislive` are all true.

Any extra SQL, changed identifier, missing index, wrong operator class,
invalid/not-ready/not-live state, diff command error, database error, or
missing `KUN_DATABASE_URL` fails the deployment. The guard never executes SQL
that changes the database and never logs the connection URL.

## Components

- `scripts/prismaProductionSchemaGuard.ts` contains the exact known SQL,
  result classification, catalog-row validation, and dependency-injected
  orchestration. It has no process or database side effects and is directly
  unit tested.
- `scripts/checkPrismaProductionSchema.ts` is the thin executable adapter. It
  loads environment variables, invokes Prisma without a shell, performs the
  read-only `pg` catalog query, closes the client, and maps failures to a
  non-zero process exit.
- `package.json` adds `prisma:deploy-safe`, preserving the existing
  `migration:resource-links` step, running the guard, and generating Prisma
  Client. Existing `prisma:push` remains unchanged.
- `scripts/deployPull.ts` and `scripts/deployBuild.ts` call
  `pnpm prisma:deploy-safe` instead of `pnpm prisma:push`.
- `.github/workflows/release.yml` remains unchanged because its PostgreSQL
  service is disposable CI infrastructure, not the production target.

## Deployment Flow

Production structural/data changes must be applied first through their
reviewed preflight/sync SQL. A subsequent deploy then:

1. runs the existing resource-link compatibility migration;
2. runs the read-only production schema guard;
3. stops before build/restart if any unapproved drift remains;
4. generates Prisma Client only after the guard accepts the database;
5. continues the existing build or release activation path.

This makes the production deployment command verification-only for Prisma
schema synchronization. Future schema changes therefore require an explicit
production migration/sync step before deployment rather than relying on
`prisma db push` to mutate production automatically.

## Testing

Vitest unit tests cover:

- clean exit `0` without a catalog query;
- the exact known false-positive SQL with valid catalog metadata;
- CRLF and outer-whitespace normalization only;
- rejection of additional or altered SQL;
- rejection of unexpected Prisma exit codes;
- rejection of missing, duplicate, or structurally incorrect catalog rows;
- database validation being skipped for clean diffs and required for the
  known exception.

Verification also includes the target test, full test suite, typecheck,
production build, `git diff --check`, a real read-only guard run against the
current PostgreSQL database, and confirmation that the source index remains
valid and unchanged.

## Alternatives Rejected

- Rebuild the index with Prisma's proposed SQL: it does not resolve the next
  introspection cycle and adds avoidable locking.
- Replace the schema entry with ordinary `@@index([released])`: new databases
  would receive an index with different prefix-query performance semantics.
- Rewrite all release-date prefix filters as half-open ranges: this can remove
  the custom operator class, but it is a separate query-behavior change that
  needs dedicated tests and production query-plan validation.

## Non-Goals

- No Prisma schema or PostgreSQL index change.
- No release-date query refactor.
- No new environment variable.
- No change to disposable development or CI database initialization.
