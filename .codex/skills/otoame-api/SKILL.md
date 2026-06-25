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
- Feedback work items use `type: 'feedback'` with no recipient; user/admin feedback notices must use `type: 'system'` so notification filters work.
- `/api/tag/otomegame` and `/api/company/otomegame` are anonymous hot-path list APIs: keep anonymous responses public-cacheable, keep login/NSFW/blocked-tag cookie requests `private, no-store`, and merge NSFW plus blocked-tag visibility before calling services.
- For edit external data, duplicate checks in rewrite flows must exclude the current patch; do not use VNDB tags; preserve Bangumi/Steam source tags; resolve tag aliases to the canonical tag before creating relations/counting; tag aliases must be globally unique across other tag names/aliases; prefer VNDB companies over Bangumi companies, use Bangumi companies only as fallback, and match companies by both name and alias.

## Verification

```bash
pnpm test tests/unit/api/otomegame-route-cache.test.ts
pnpm test tests/unit/api/process-external-data.test.ts
pnpm test tests/unit/api/fetch-companies.test.ts
pnpm test tests/unit/api/company-service.test.ts
pnpm test tests/unit/api/<target>.test.ts
pnpm test
pnpm typecheck
```
