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
- Game-detail resource lists must not expose real download `content`, extraction `code`, or archive `password`; return only preview link fields from `/api/patch/resource` and fetch sensitive link fields through `POST /api/patch/resource/download/access` with patch/resource/link ownership, status, visibility checks, and `Cache-Control: private, no-store`.
- Download access grants are resource-level and fixed at 24 hours from the first access. Only a visitor's first `resource_grant` for a game resource consumes the Shanghai daily 5 / weekly 20 product quota; `link_reveal`, `reused`, and restore do not consume quota or extend the grant. Logged-in users and patch resources currently have no product hard limit.
- `/api/patch/resource` may derive resource-level `obtained` / `obtainedExpiresAt` and link-level `revealed`, but must stay `private, no-store` and preview-only. The restore route is read-only and may return only mirrors that the same actor previously revealed under an active grant; it must not create a grant or access event.
- Access and restore share a single Redis technical rate limit of 30 actions per actor per minute. Only a first-time visitor without a valid cookie uses an IP hash for that limiter; IP must never become a product-quota identity. Resource access outcome logs may contain only `operation`, `outcome`, `actorType`, and optional `section`.
- Message notification list/create/read/unread endpoints are personalized APIs; keep `/api/message`, `/api/message/all`, `/api/message/read`, `/api/message/unread`, `/api/user/session`, and conversation read/status responses on `Cache-Control: private, no-store`.
- `POST /api/message` is an admin notification-creation route and must require `role >= 3`; ordinary business flows should create notifications server-side with `createMessage` / `createDedupMessage`.
- Message notification read should update only the current user's unread `user_message` rows (`status = 0`) and must not clear or rewrite private chat counters. If there is no matching unread notification, return success without running an empty `updateMany`; clearing read notifications should likewise skip `deleteMany` when no matching `status = 1` notification exists.
- Message notification list/unread reads and read/clear writes must enforce user-scoped Redis rate limits after auth and before DB work. Current limits are 180 notification reads per minute via `notification-read` for `/api/message/all` and `/api/message/unread`, and 30 notification writes per minute via `notification-write` for `/api/message/read` PUT/DELETE; limited responses return `429`, `Retry-After`, `private, no-store`, and the JSON body is the user-visible retry string. `/api/user/session` also carries the top-bar unread state, so its unread subquery must consume `notification-read` before reading `user_message` / `user_conversation`; when limited, still return the user session with `unread: null` so the client preserves the current red-dot state instead of treating the user as logged out.
- User-triggered favorite/like notification flows should only create notification rows when the relation is newly added. Removing an existing favorite/comment-like/rating-like/resource-like must not recreate a notification, even if an older notification was already cleared by the recipient.
- Comment mention notifications must deduplicate mentioned user IDs, skip the sender, cap notifications per comment, and query existing users before `createMany` so forged or stale mention links do not fail an already-created comment.
- Private chat conversation read must only clear the current user's unread side. If that side's unread counter is already `0`, return success without rewriting message statuses or the conversation row.
- Private chat image messages must atomically consume metadata written by `/api/message/conversation/[id]/image` for the same conversation and user; never trust arbitrary client-submitted image URLs or allow one upload metadata record to be replayed into multiple messages. If the DB message transaction fails after metadata consumption, best-effort restore the consumed metadata so the user can retry without reuploading.
- Private chat deletion means hiding the shared conversation for the current user only. Do not delete `user_conversation`; set the current participant hidden flag and clear only their unread counter. Repeated deletion of an already hidden conversation with no current-user unread count should return success without rewriting the row. Reopening an existing hidden conversation restores current-user visibility, and sending a new message restores both participants.
- Private chat unread aggregation must ignore conversations hidden for the current user; hidden chats should not keep the global chat red dot active.
- Private chat conversation summaries must respect deleted-message tombstones; when the latest message is deleted, show a deleted placeholder rather than old text or image metadata. Image summaries must be based on valid image metadata (`image_url` or a valid `image_group` image), and corrupted image-only latest rows should show `[图片不可用]` instead of pretending a normal image is present.
- Private chat message fetches must tombstone deleted messages in the API response; do not return original content, image metadata, image groups, or reply previews for `is_deleted` rows.
- Private chat message fetches must not return `type: 1` image messages unless at least one valid image metadata object is present. If a legacy or corrupted non-deleted `type: 1` row has no valid image payload, normalize it to a text message and use `[图片不可用]` when its content is empty so clients never render an empty image bubble.
- Private chat message fetches must return `messages` chronologically from old to new for initial, `beforeId`, and `afterId` reads. It is fine to query the newest window in descending order, but reverse the response before returning it.
- Private chat dynamic conversation IDs in route params and server-rendered chat pages must be strict decimal positive integers; do not parse them with `parseInt`, because values like `5abc` must not be accepted as conversation `5`.
- Private chat text sends and text edits must validate content after trimming; do not allow whitespace-only messages through API schemas.
- Private chat conversation check and create/open routes are personalized user-state APIs. Keep `/api/message/conversation/check` and `POST /api/message/conversation` on `Cache-Control: private, no-store`, including validation/auth error responses.
- Private chat new-conversation moemoepoint charges must be atomic. Use a transaction-local `user.updateMany` guarded by `moemoepoint >= 10`; if `count` is 0, return the insufficient-points string and do not create `user_conversation`. If concurrent creation hits the `[user_a_id, user_b_id]` unique constraint, re-read and return the existing conversation instead of surfacing a request failure.
- Private chat sends must re-check the recipient user's `allow_private_message`; existing conversations must not bypass a later privacy setting change that disables receiving private messages.
- Private chat image uploads must also re-check the recipient user's `allow_private_message` after access/type/size checks and before the real image-upload quota, moemoepoint charge, Sharp processing, or S3 upload. Oversized images and requests above Next's default 10MiB client body buffer must return `413`, `private, no-store`, and the user-visible `图片大小不能超过 8 MB` string instead of surfacing multipart parse 400s or 500s.
- Private chat send, image-upload, conversation check/open, conversation remove/hide, conversation-list, message-fetch, read-sync, message edit/delete, and server-rendered initial chat-load flows must enforce user-scoped Redis rate limits after auth and before avoidable work. Current hard limits are 30 sends per minute, 30 image upload intake requests per minute via `image-upload-intake` before multipart `formData()` parsing, 10 real image uploads per 5 minutes via `image-upload` after access/type/size/privacy checks, 60 conversation check/open attempts per minute, 30 conversation remove/hide operations per minute via `conversation-manage`, 180 conversation-list/message reads/read-syncs/initial chat loads per minute via `message-read`, and 60 message edits/deletes per minute via `message-write`; API routes return `429 Too Many Requests` with `Retry-After`, keep `Cache-Control: private, no-store`, keep the JSON body as a user-visible retry string, and avoid DB reads/writes, multipart parsing, expensive image processing/S3 writes, or delete-time S3 cleanup when limited. `DELETE /api/message/conversation/[id]?action=conversation` must run `conversation-manage` before `deleteConversation` so limited requests do not read `user_conversation`; `deleteConversation` still keeps a service-level fallback check before hidden-state writes for direct calls, and route calls must avoid double-counting that same request. Server actions should return the same user-visible retry string before DB reads.
- Private chat image upload also has a user-scoped hourly quota for S3 cost control: first 5 successful uploads per hour are free, then each upload costs 5 moemoepoints before Sharp/S3 work. Use atomic Redis quota reservation plus Prisma `updateMany` with `moemoepoint >= cost`; reject insufficient balance before image processing, refund/rollback quota on image processing, S3 upload, or metadata failures, return user-visible retry/invalid-image strings instead of surfacing 500s, distinguish object-storage upload failure from metadata-registration failure in user-visible strings, and fail closed with a retryable error if hourly quota cannot be reserved.
- Private chat single-message delete must tombstone the DB row and best-effort delete only unreferenced canonical `conversation/<conversationId>/<uid>-<timestamp>-<uuid>.avif` S3 objects from that message. Check active references in other non-deleted messages' `image_url`, `image_group`, and `reply_image`; S3 cleanup failures must not undo the message delete. Repeated deletes of an already tombstoned message should return success without rewriting the row or re-running S3 cleanup.
- Feedback work items use `type: 'feedback'` with no recipient; user/admin feedback notices must use `type: 'system'` so notification filters work.
- `/api/home`, `/api/tag/otomegame`, and `/api/company/otomegame` are anonymous hot-path read APIs: keep anonymous responses public-cacheable, keep login/NSFW/blocked-tag cookie requests `private, no-store`, and merge NSFW plus blocked-tag visibility before calling services.
- `/api/home` is only a fallback for empty static home payloads; do not make normal home loads fetch it, and do not cache empty `galgames` responses.
- For edit external data, duplicate checks in rewrite flows must exclude the current patch; do not use VNDB tags; preserve Bangumi/Steam source tags; resolve tag aliases to the canonical tag before creating relations/counting; tag aliases must be globally unique across other tag names/aliases; prefer VNDB companies over Bangumi companies, use Bangumi companies only as fallback, and match companies by both name and alias.
- After creating, deleting, or externally fetching patch-company relations, invalidate both company/list caches and the affected patch detail/introduction cache so company pages and game detail refreshes agree.

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
