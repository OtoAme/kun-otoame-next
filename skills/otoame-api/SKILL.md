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
- Public resource list and preview APIs must redact download credentials (`content`, `code`, `password`). Administrator inbox details and resource previews may return full links after independent `role >= 3` checks; keep every personalized response `Cache-Control: private, no-store` and credentials only in component memory.
- Inbox and review HTTP routes stay under `/api/admin/*`. Inbox schemas live in `validations/inbox.ts`; search the selected sources' entire pending backlog before the oldest-candidate limit, use the same predicates for filtered totals, and keep sidebar counts global.
- Shoutbox user writes stay under `/api/shoutbox`; new reports use the `ops_case` carrier through the existing report URL. Official lifecycle and historical report moderation remain under `/api/admin/shoutbox` with `role >= 3`; new case moderation uses `/api/admin/case`. Reject new reports for any message whose author currently has role 4, including ordinary and official messages; keep existing reports available for resolution. The service derives the public reportable flag without exposing the author role. Other official reports may be resolved but never auto-hidden or sent through ordinary hide/remove/restore.
- Case reads use the server-side visibility matrix in `docs/modules/api-services.md`; reporters are not anonymous to handlers (D15). Followers receive only their own notes, never other reporters’ dialogue or identities, and private followers do not receive counts. The opener of a `content_violation` report reads only their own notes, `role >= 3` replies and system rows other than `withdrawn`, without a count, and the issue-list preview applies the same filter (D31); resource-case openers still read everything. Legacy feedback/report URLs adapt to new cases without falling back to old-table writes.
- Staff case inbox reads and counts include only `open` / `waiting_owner`. Match resource names only among resources the queue's cases target, never truncated. `GET /api/admin/case` narrows the shared search predicates by `searchField` (default `all`; `id` is exact and accepts `#8`); under `all` in the default order (`time` ascending), a case whose number the text names leads page 1 within the current filter, and the paged rows skip it without changing `total`. The inbox search keeps every field and its order. Replies and opener resubmissions share the user/case rate bucket; closure notices exclude the actor.
- `GET /api/admin/case` orders by `sort`/`order`. Status and kind sort by their display groups (`open` with `waiting_owner`): count each group with `groupBy` and read the page window across the segments with per-segment skip/take, never raw SQL. Reporter and owner sort by name, nameless rows last in both directions.
- Only the owning side's own reply sets `first_owner_response_at`: a staff reply on a publisher-owned case does not (D32). Every handling-side reply carries `authorSide`: `staff` for `role >= 3`, `original-publisher` for the publisher a public case was handed off from (the handoff's `from_owner_id` once the resource is gone), `publisher` for the owning publisher. An unmarked reply is a reporter's, so a withdrawn opener reads as another reporter (D33).
- Only `canCloseAsOriginalPublisher` (latest `escalated` trigger `timeout`, `reopened_count = 0`, unresolved) lets the original publisher resolve a handed-off case (D36); capabilities, `resolve` and `propose` all use it, and `propose` refuses an eligible case. The closure follows the publisher's closing rules with `actor_type publisher` and `notifyStaff: false`: no `case_close` log, no staff notice.
- An opener who withdraws while others still subscribe hands the case to the earliest subscriber (`created`, then `user_id`) through a conditional update on id, old `reporter_id`, status and revision; only a `waiting_reporter` case resets `status_changed_at` and bumps `revision`. Delete the withdrawer's subscription, write `withdrawn` with `successor_id` and notify the successor; with no one left, close as 开启者撤回 (D33).
- A misjudgement restore closes as 不成立 with status `rejected`, including when the target is already gone.
- Submission candidates must order `COALESCE(submitted_at, created), id` in the database before limiting. Daily inbox processing counts include the three review log types plus `case_close`, using the reviewer's Shanghai natural-day window and exclusive next-day boundary.
- Never trust a client-supplied S3 URL or upload metadata; consume server-registered metadata atomically, exactly once.
- All runtime moemoepoint mutations go through `app/api/moemoepoint/service.ts` in the owning business transaction; never write `moemoepoint` / `moemoepoint_reserved` directly.
- Shoutbox keyword rejection must happen before database and accounting work. Three distinct pending reporters may atomically hide a normal message; restore refunds at most the recorded cost once through a stable ledger idempotency key.
- Submission approval writes `patch` only inside the final transaction; a lost `pending` guard returns `409` and rolls back publish, settlement, notifications and logs.
- Submission approve/reject/violate must claim `pending` before deposit settlement or rewards; approval keeps `publishCore` before the claim in the same transaction. A losing review must return the existing state conflict before calling settled-reservation primitives.
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
