---
name: otoame-api
description: Use when changing kun-otoame-next API routes, service modules, validations, auth flows, admin APIs, search/list endpoints, messages, comments, tags, companies, ratings, or user-facing business rules.
---

# OtoAme API

Use this skill for API and business-service work; per-domain rules live in the module guide.

## Required References

- `docs/modules/api-services.md` — API 约定, 消息和反馈, 萌萌点账务, 搜索和列表, 标签和公司, 编辑外部数据合并, 资源发布和上传, 投稿域 patch_submission, 输入校验, 安全约束
- `docs/modules/data-cache-upload.md` — Patch 缓存, 上传与 S3, 下载授权与事件
- `docs/project/testing.md`

## Rules

- Enforce auth, role, ownership and CSRF in the route or service. Frontend visibility is never a permission.
- Handlers excluded from middleware (`/api/upload/*`, `/api/admin/stickers/import`, `PATCH /api/patch-submission/asset`) must call `verifyKunCsrf` themselves.
- Never return `content`, `code` or `password` from list or preview APIs, and keep every personalized response `Cache-Control: private, no-store`.
- Never trust a client-supplied S3 URL or upload metadata; consume server-registered metadata atomically, exactly once.
- All runtime moemoepoint mutations go through `app/api/moemoepoint/service.ts` in the owning business transaction; never write `moemoepoint` / `moemoepoint_reserved` directly.
- Submission approval writes `patch` only inside the final transaction; a lost `pending` guard returns `409` and rolls back publish, settlement, notifications and logs.
- Direct create/rewrite external enrichment runs after the core commit: return structured warnings and keep the committed success if enrichment, cache invalidation or IndexNow fails. Do not apply this downgrade to submission approval.
- Post-transition notifications are best-effort: log failures, never roll back an already committed transition.
- Run user-scoped rate limits after auth and before DB access, multipart parsing, Sharp/S3 work or S3 cleanup; thresholds live in `app/api/message/conversation/rateLimit.ts` and `app/api/patch-submission/rateLimit.ts`.
- Invalidate the matching caches after every patch/resource/tag/company write.
- Company writes must treat a shared alias or overlapping batch evidence as ambiguous instead of selecting the first row. Manual VNDB refresh follows the server-side resolver flag and reports newly inserted relations separately from already-resolved companies.
- Define request schemas in `validations/*`; return immediately when a parse helper yields a string.

## Verification

```bash
pnpm test tests/unit/api/<target>.test.ts   # while iterating
pnpm test:changed && pnpm typecheck         # default commit gate
pnpm test                                   # checkpoints — see docs/modules/quality.md
```
