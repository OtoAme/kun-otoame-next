---
name: otoame-api
description: Use when changing kun-otoame-next API routes, service modules, validations, auth flows, admin APIs, search/list endpoints, messages, comments, tags, companies, ratings, or user-facing business rules.
---

# OtoAme API

Use this skill for API and business-service work.

## Required References

- Module guide: `docs/modules/api-services.md`
- Data/cache guide when writes or cache are involved: `docs/modules/data-cache-upload.md`
- Testing guide: `docs/project/testing.md`

## Rules

- Keep `route.ts` thin: parse, auth, role, call service, return JSON.
- Put Prisma transactions, cache invalidation, messages, external calls, and compensation in service/helper files.
- Define request schemas in `validations/*`.
- State-changing APIs must satisfy CSRF header and origin/referer host checks.
- For upload APIs, verify CSRF in the handler because middleware excludes `/api/upload/*`.
- Never rely on frontend visibility for permissions.
- Keep resource ownership, role, and admin checks in the API/service layer.

## Verification

```bash
pnpm test tests/unit/api/<target>.test.ts
pnpm test
pnpm typecheck
```
