---
name: otoame-testing
description: Use when adding, fixing, or reviewing tests in kun-otoame-next, especially Vitest tests for APIs, Prisma services, Redis cache, resource links, uploads, themes, or utility functions.
---

# OtoAme Testing

Use this skill for project-specific testing work.

## Required References

- Full testing guide: `docs/project/testing.md`
- Development workflow: `docs/project/development.md`

## Test Stack

- Vitest config: `vitest.config.ts`
- Test root: `tests/unit`
- Runtime: Node environment
- Alias: `~/*` points at repository root

## Rules

- For bugfixes, write a failing regression test before implementation.
- Prefer pure function tests for `utils/*`, `constants/*`, and `validations/*`.
- For API service tests, mock Prisma, Redis, cache helpers, and external APIs.
- Use `vi.hoisted` for values referenced by `vi.mock` factories.
- Do not connect to real PostgreSQL, Redis, S3, GitHub, Bangumi, VNDB, or DLSite in unit tests.

## Common Commands

```bash
pnpm test
pnpm test tests/unit/resource-link.test.ts
pnpm test tests/unit/api/batch-tag.test.ts
pnpm typecheck
```

## What To Assert

- Return values and user-visible behavior.
- Prisma query conditions and transaction writes.
- Cache invalidation calls after writes.
- Upload lock/finalize/compensation behavior.
- Create publish staging: hidden `PATCH_STATUS_PUBLISHING` row before upload, no S3/sharp/network work inside `$transaction`, required external data before visible status, reward only after success, and `PATCH_STATUS_VISIBLE` as the final publish step.
- Patch banner compensation: returned uploaded keys, cleanup on mixed S3 failure, cleanup on upload/external/final transaction failures, and no cache invalidation/IndexNow/reward when strict create external data fails.
- Public visibility filters: home/list/search/ranking/tag/company/resource/detail public reads include `PATCH_STATUS_VISIBLE`.
- Message regressions: feedback work items stay `feedback`, but feedback notices sent to users/admins are `system`.
- Role, permission, owner mismatch, CSRF, and quota edge cases when service-level logic owns them.
- Edit external-data regressions: VNDB company priority, VNDB tags ignored, Bangumi company fallback, Bangumi tags retained, alias-aware tag/company matching, tag alias uniqueness on create/update, Bangumi summary/title copy, duplicate checks excluding current rewrite patch, create-page draft clearing, and async store merges.
- Tag migrations should prefer pure-function tests for generated plans because production tag data is not available locally.

Avoid tests that only duplicate implementation steps without checking behavior.
