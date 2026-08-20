---
name: otoame-review
description: Use when reviewing kun-otoame-next code changes for API behavior, Prisma writes, Redis cache invalidation, uploads, auth, deployment, tests, or release risk.
---

# OtoAme Review

Use this skill for project-specific code review.

## Required References

- Review checklist: `docs/project/review.md`
- Architecture map: `docs/project/overview.md`
- Module map: `docs/modules/index.md`
- Testing guide: `docs/project/testing.md`
- Quality and docs/skill rules: `docs/modules/quality.md`
- Deployment guide when CI/build files changed: `docs/project/deployment.md`

## Review Priorities

1. Security: auth, roles, CSRF, secret leakage, unsafe redirects, audit log exposure.
2. Data integrity: Prisma transactions, counters, duplicate handling, destructive schema changes.
3. Cache correctness: patch/resource/tag/company/favorite invalidation.
4. Upload safety: Redis consume locks, S3 compensation, finalize, cleanup.
5. Deployment safety: standalone assets, server.mjs/server.js, PM2 cwd, Prisma client generation, env vars.
6. Docs/skills: source paths, workflow facts, triggers, module references, and post-commit sync remain consistent.
7. Tests: regression coverage for behavior changes.

Resource-access schema reviews must include `migration/production-resource-access-bootstrap-preflight-2026-07-12.sql`, its sync, grant interruption states, Steam invalid-index recovery, fixed snapshots, and command-scoped Release tag pinning.

Docs/skill updates must be reviewed as a separate commit from application code, tests, migrations, or generated artifacts.

## Output Format

Lead with findings:

```text
Critical
- [file:line] ...

Important
- [file:line] ...

Minor
- [file:line] ...

Questions
- ...
```

If there are no findings, say that clearly and list unverified risks or commands not run.
