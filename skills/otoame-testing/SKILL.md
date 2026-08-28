---
name: otoame-testing
description: Use when adding, fixing, or reviewing tests in kun-otoame-next, especially Vitest tests for APIs, Prisma services, Redis cache, resource links, uploads, themes, or utility functions.
---

# OtoAme Testing

Use this skill for project-specific testing work; checklists and the file map live in the testing guide.

## Required References

- `docs/project/testing.md` — 当前测试栈, 测试目录, 何时新增测试, 测试优先级, Vitest mock 模式, API service 测试约定, Redis 测试约定, Prisma/事务测试约定, 上传和资源测试, 浏览器与 HTTP 端到端脚本
- `docs/project/development.md`

## Rules

- Fix bugs red-green: a failing regression test named after the user-visible behavior, then the minimal fix.
- Prefer pure-function tests (`utils/*`, `constants/*`, `validations/*`), then services with Prisma/Redis/cache/external APIs mocked, then route handlers only when HTTP behavior is the risk.
- Use `vi.hoisted` for any value a `vi.mock` factory references.
- Never connect a unit test to real PostgreSQL, Redis, S3, GitHub, Bangumi, VNDB or DLSite.
- Real DDL, lock-timeout and migration rehearsals run only on a disposable PostgreSQL; migration unit tests lock the SQL contracts statically and keep preflights read-only.
- `tests/e2e/*.e2e.ts` create and settle real records. Confirm the running 3100 server actually uses disposable `touchgal_e2e`; never fall back to the default `.env` database.
- Assert behavior — return values, Prisma conditions and transaction boundaries, cache invalidation, upload lock/finalize/compensation, permission and quota edges. Never assert only that a mock was called.
- Money paths assert the business write, conditional balance update and ledger snapshot in one transaction, plus negative reversals and reason truncation.

## Verification

```bash
pnpm test tests/unit/<target>.test.ts   # while iterating
pnpm test:changed && pnpm typecheck     # default commit gate
pnpm test                               # checkpoints — see docs/modules/quality.md

pnpm test tests/unit/api/conversation-rate-limit.test.ts
pnpm test tests/unit/gallery-upload.test.ts tests/unit/gallery-route.test.ts
pnpm test tests/unit/theme.test.ts
```
