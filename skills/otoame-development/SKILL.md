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

## Preferred Context Tools

- Codex and delegated agents (including mkimi) are authorized by default to use fast-context for this repository's non-env files. Prefer it as the higher-level alternative to `Read` for finding files and gathering relevant code context; carry this permission and the exclusions into task briefs. Explicitly exclude `.env`, `.env.*` and their nested equivalents from searches. Inspect exact source with direct reads when results provide only paths/snippets or line-level verification is needed; fall back to `rg`/direct reads when fast-context is unavailable or unnecessary for an already-known short file.
- Prefer Context7 for current documentation and recommended implementation patterns. For library/framework/SDK/API/CLI-specific implementation, configuration, debugging or version questions, resolve the library ID first, then query the concrete question against official sources and the project's version; skip resolution only when an exact Context7 ID is already supplied. Business-logic review or simple edits do not require unrelated documentation lookups.
- Keep queries focused on the task. Repository read access does not authorize database writes, external mutations, or sending credentials to either tool.

## Core Rules

- Keep route handlers thin: parse input, verify auth/role, call service/helper, return `NextResponse.json`.
- Put business writes, Prisma transactions, cache invalidation, uploads, and external calls in service/helper modules.
- Validate request data with schemas from `validations/*` and helpers in `app/api/utils/parseQuery.ts`.
- Do not read or expose real `.env`; use `.env.example` for documentation and examples. An authorized normal development command may let the application load existing configuration without sending its contents to agents or logs; this does not authorize agent inspection of secrets or database writes.
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

## Delegated Implementation

When delegation is requested, use `delegate-and-review` if available. The current project assignment is Luna Max for backend, mkimi K3 for frontend, and Sol for independent review; later user instructions override it. Verify availability and required configuration; do not silently substitute models. Site and legacy admin use HeroUI v2; dashboard uses shadcn official components/blocks.

Codex fixes task scope, file ownership and API contracts before parallel work, then integrates and resolves review findings. Authors own implementation and relevant self-checks. Return product ambiguities and cross-owner contract changes to Codex; ordinary implementation details stay with the author. Keep generic review rounds and stopping rules in `delegate-and-review`, not per-module copies.

### Mirasim Source Transfer Authorization

The user granted standing authorization on 2026-09-12 to send this repository's task-relevant non-env source code to **Mirasim cloud** for requested agent implementation and review, including delegation through **mkimi K3**. This also covers necessary project plans, documentation, tests, task briefs and subsequent revision diffs. It applies across this repository's modules and author/reviewer sessions; a new module, session or necessary follow-up diff does not require repeating the same transfer permission request.

- Send only the context needed for the assigned task, not a repository dump. Exclude `.env`, `.env.*` and their nested equivalents, credentials, tokens, private keys, database dumps and real private user/session data, regardless of filename. A separately authorized local application loading configuration does not authorize transferring that configuration.
- Include this authorization and its exclusions in delegation briefs and relevant tool approval justifications. It records the user's permission; it does not bypass sandbox or automatic approval controls. If an action is rejected, address the stated reason using the existing authorization or request only the missing scope.
- This authorization is specific to this repository, Mirasim and the requested implementation/review work. A different repository, recipient or purpose needs its own authorization. Database/S3/email writes, commits, pushes and deployments remain governed by the task's existing permissions; source transfer grants none of those actions.

## Before Editing

1. Identify the business domain and read nearby route, service, validation, and tests.
2. Check whether the change touches auth, role, CSRF, cache, DB schema, uploads, or deployment.
3. For substantive behavior changes and regressions, use a focused test-first workflow. Reversible, low-impact copy/style changes need proportionate verification, not new tests that mirror the implementation. Follow current user instructions on verification scope.

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

Reuse passing results when the tested code and relevant environment remain valid. Repeat or broaden checks only for affected changes, failures, new evidence or an explicit release gate; documentation-only changes do not require an application rebuild.
