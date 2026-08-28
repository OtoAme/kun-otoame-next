---
name: otoame-development
description: Use when changing OtoAme application code, adding routes, updating APIs, modifying Prisma schema, editing cache behavior, or working in the kun-otoame-next repository.
---

# OtoAme Development

Use this skill for project-specific development in `kun-otoame-next`.

These skills are project assets, not agent-tool assets. They live in the repository-root `skills/` directory; `.codex/skills` and `.claude/skills` are symlinks to it. Edit the files under `skills/` and never fork a tool-specific copy.

## Required References

Read the relevant project docs before editing:

- Architecture and runtime map: `docs/project/overview.md`
- Module navigation: `docs/modules/index.md`
- Local setup, environment variables, admin bootstrap, and common change paths: `docs/project/development.md`
- Testing expectations: `docs/project/testing.md`

## Core Rules

- Keep route handlers thin: parse input, verify auth/role, call service/helper, return `NextResponse.json`.
- Put business writes, Prisma transactions, cache invalidation, uploads, and external calls in service/helper modules.
- Validate request data with schemas from `validations/*` and helpers in `app/api/utils/parseQuery.ts`.
- Do not read or expose real `.env`; use `.env.example` for documentation and examples.
- After schema changes, run `pnpm prisma:push` or at minimum `pnpm prisma:generate`.
- After patch/resource/tag/company writes, verify the matching cache invalidation path.
- Route every runtime moemoepoint mutation through `app/api/moemoepoint/service.ts`; keep the business write, conditional available-balance update, and ledger snapshot in one Prisma transaction.
- Preserve CSRF header + origin/referer checks and API-layer permissions.
- When running shell commands against Next App Router dynamic-segment paths such as `app/api/message/conversation/[id]/service.ts`, quote every path argument with single quotes or escape brackets in commands like `sed`, `rg`, `git add`, and `pnpm test`; zsh treats unquoted `[id]` as a glob pattern.
- Keep legacy `touchgal` / `galgame` names when they are compatibility keys, cookies, types, or deployment ids.
- For onboarding or setup questions, answer from `docs/project/development.md` instead of inventing shell steps.
- Every commit in this repository must use Conventional Commits: `<type>(<scope>): <subject>`. Use types such as `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`, or `revert`; if the user provides a non-conventional message, convert it to the nearest conventional form or ask when the intent is ambiguous.
- After every code commit, check and update matching `docs/project/*`, `docs/modules/*`, and `skills/*/SKILL.md`; major behavior, API, data, cache, deployment, testing, or workflow changes must update docs and skills.
- Keep docs/skill updates in a separate conventional commit from application code, tests, migrations, or generated artifacts.

## Project Hotspots

- API routes: `app/api/*`
- Pages/actions: `app/*`
- Shared components: `components/kun/*`
- Business components: `components/<domain>/*`
- Prisma client: `prisma/index.ts`
- Schema folder: `prisma/schema/*`
- Redis/cache: `lib/redis.ts`, `app/api/patch/cache.ts`
- Upload/S3: `app/api/upload/*`, `app/api/patch/resource/_helper.ts`, `lib/s3.ts`
- Environment validation: `validations/dotenv-check.ts`

For domain-specific work, prefer the narrower skills: `otoame-api`, `otoame-data-cache`, `otoame-frontend`, or `otoame-operations`.

## Before Editing

1. Identify the business domain and read nearby route, service, validation, and tests.
2. Check whether the change touches auth, role, CSRF, cache, DB schema, uploads, or deployment.
3. For behavior changes and bugfixes, use test-first workflow unless the user explicitly requests otherwise.

## Completion Gate

After code is committed, perform the docs/skill sync as its own follow-up commit when needed.

Verification is tiered so its cost scales with the change, not with the size of the test suite (details: `docs/modules/quality.md`):

```bash
pnpm test tests/unit/<target>.test.ts   # while iterating
pnpm test:changed && pnpm typecheck     # default commit gate (import-graph selection)
pnpm test                               # pre-push/release, shared-infra changes, or fs-read assets (styles/*.css, migration/*.sql, prisma/schema/*)
pnpm build                              # only when build output is affected
```

Report any command you could not run and why.
