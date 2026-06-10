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
- Deployment guide when CI/build files changed: `docs/project/deployment.md`

## Review Priorities

1. Security: auth, roles, CSRF, secret leakage, unsafe redirects, audit log exposure.
2. Data integrity: Prisma transactions, counters, duplicate handling, destructive schema changes.
3. Cache correctness: patch/resource/tag/company/favorite invalidation.
4. Upload safety: Redis consume locks, S3 compensation, finalize, cleanup.
5. Deployment safety: standalone assets, server.mjs/server.js, PM2 cwd, Prisma client generation, env vars.
6. Docs/skills: source paths, workflow facts, triggers, and module references remain consistent.
7. Tests: regression coverage for behavior changes.

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
