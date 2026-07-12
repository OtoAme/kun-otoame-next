---
name: otoame-data-cache
description: Use when changing kun-otoame-next Prisma schema, database access, Redis cache, upload metadata, S3 resources, patch resource attributes, migrations, or cache invalidation behavior.
---

# OtoAme Data Cache

Use this skill for persistence, cache, and upload consistency work.

## Required References

- Module guide: `docs/modules/data-cache-upload.md`
- Operations guide for migrations: `docs/modules/operations.md`
- Testing guide: `docs/project/testing.md`

## Rules

- Use `prisma/index.ts` for database access.
- After local schema changes run `pnpm prisma:push` or `pnpm prisma:generate`; development, first install, and disposable CI may use `prisma:push`.
- Production deploy paths use `pnpm prisma:deploy-safe`, and reviewed preflight/sync SQL must already be applied to the target database.
- Keep the production guard read-only and the exception exact: accept only an empty diff or the PostgreSQL-catalog-verified Prisma 7.8 `public.patch_released_idx` operator-class false drift. Never broaden it to ignore arbitrary diff output; any other drift must abort before build or standalone replacement.
- Never execute that false drift's proposed `DROP INDEX` / `CREATE INDEX` SQL because it recurs after introspection and index replacement can block production writes.
- Use `lib/redis.ts`; helper keys are unprefixed because the helper adds `kun:touchgal`.
- Direct `redis` / `runRedisCommand` usage needs a reason and explicit full key prefixes.
- After patch/resource/tag/company writes, call the matching cache invalidation helper.
- Patch resource-derived attributes and card/detail resource counts must use the shared published-resource visibility rule in `utils/patchResourceAttributes.ts`; pending, banned, or deleted resources must not affect `patch.type`, `patch.language`, `patch.platform`, or visible resource counts.
- Patch-company relation writes must also invalidate the affected patch content/introduction cache; company cache invalidation alone leaves stale game detail pages.
- Resource download grants live in `patch_resource_access_grant`, which contains only `actor_key`, `resource_id`, and `expires`. Keep one 24-hour grant per actor/resource; revealing another mirror, reusing a mirror, or restoring after refresh must not extend it.
- `patch_resource_access` remains the mirror-level event table, and `access_kind` is the only new event-classification field: write `resource_grant` for a new resource grant and `link_reveal` for the first access to another mirror under that grant. Product quota counts only visitor game-resource `resource_grant` events. Restore is read-only; do not add a persisted `revealed` field or ID array.
- Resource access grant/event writes do not invalidate public patch/resource caches. Personalized preview and sensitive access/restore responses stay `private, no-store`. Redis supplies only the short technical action rate limit, not daily/weekly product quota; clearing the visitor cookie creates a new visitor identity, while IP hash is restricted to the first no-cookie request's technical limiter.
- Anonymous tag/company game-list APIs use short response caches; never cache personalized login/NSFW/blocked-tag results, and keep Redis list cache keys scoped by the full visibility where.
- Home `home_data:*` and `/api/home` anonymous response caches must not store empty `galgames` payloads; this is a deploy/ISR empty-snapshot guard, not a generic rule for valid empty paginated lists.
- Upload publishing must preserve role/quota checks, `consumeUpload`, S3 compensation, `finalizeUpload`, and cleanup behavior.
- Private chat image upload uses its own Redis metadata (`conversation:image-upload:<conversationId>:<uid>:<urlHash>`) instead of resource upload consume locks. Register final AVIF metadata after S3 upload, atomically consume it during message send so it cannot be replayed, best-effort restore consumed metadata when the message DB transaction fails, and best-effort delete the just-uploaded S3 object if metadata registration fails.
- Private chat image upload must run the lightweight `image-upload-intake` route rate limit before multipart `formData()` parsing, then re-check the recipient user's `allow_private_message` before the real `image-upload` action limit, hourly quota, moemoepoint charge, Sharp work, or S3 upload so disabled recipients do not create storage cost or consume the real image-upload quota.
- Private chat image upload has a user-scoped hourly quota Redis key `conversation:image-upload-quota:<uid>`: first 5 successful uploads per hour are free, then each costs 5 moemoepoints. Reserve quota atomically before Sharp/S3, charge with Prisma `updateMany` and `moemoepoint >= cost`, refund and roll back quota on processing/upload/metadata failures, return user-visible invalid-image or retryable upload errors instead of throwing 500s, distinguish object-storage upload failure from metadata-registration failure in those strings, and fail closed when quota reservation is unavailable.
- Private chat uploaded-but-unsent S3 images are cleaned by `pnpm maintenance:conversation-images:dry` before `pnpm maintenance:conversation-images:apply`; only delete canonical `conversation/<conversationId>/<uid>-<timestamp>-<uuid>.avif` objects older than the safety window and not referenced by non-deleted private messages through `image_url`, `image_group`, or `reply_image`.
- Private chat single-message delete also best-effort cleans S3 after tombstoning: only delete canonical `conversation/` objects extracted from trusted storage URL prefixes and only when no other non-deleted private message references the key. Repeated deletes of an already tombstoned message must not re-run S3 cleanup. Reference checks or S3 delete failures must log and leave cleanup to the orphan-image maintenance script.
- Private chat per-user hide state lives on `user_conversation.user_a_hidden` / `user_b_hidden`; production schema sync uses `migration/production-conversation-hidden-preflight-2026-07-01.sql` and `migration/production-conversation-hidden-sync-2026-07-01.sql`.
- Private chat new-conversation moemoepoint charges must be guarded with transaction-local Prisma `updateMany` and `moemoepoint >= 10`; never rely only on a pre-transaction balance read. Concurrent `[user_a_id, user_b_id]` unique conflicts should be recovered by re-reading the existing conversation; ordinary-user transaction rollback must prevent charging twice.
- Message action rate limits use Redis Lua in `app/api/message/conversation/rateLimit.ts` with explicitly prefixed keys `conversation:rate-limit:<action>:<uid>`. Current actions are `send`, `image-upload-intake`, `image-upload`, `conversation-open`, `conversation-manage`, `message-read`, `message-write`, `notification-read`, and `notification-write`; keep checks atomic and user-scoped, run conversation check/open, API-level image-upload intake before multipart parsing, API-level conversation remove/hide, conversation-list, message-fetch, read-sync, server-rendered initial chat-load, single-message edit/delete, notification list/unread reads, and notification read/clear writes before DB reads/writes or delete-time S3 cleanup, map limited API actions to `429 Too Many Requests` with `Retry-After` and `private, no-store`, and return the same user-visible retry string from server actions; `deleteConversation` also keeps a service-level `conversation-manage` fallback after member verification but before hidden-state writes, and HTTP routes that pre-check the same action must skip the fallback to avoid double-counting one request. Action rate-limit Redis errors fail open, while image hourly quota Redis errors fail closed to avoid unmetered S3 writes.
- Gallery upload uses `app/api/edit/galleryUpload.ts`: originals stay at `patch/{patchId}/gallery/{imageId}.{ext}`, thumbnails at `patch/{patchId}/gallery/thumbnail/thumb-{imageId}.{thumbExt}` only when a real thumbnail exists. Keep the `thumb-` filename prefix so browser Network traces clearly distinguish thumbnails from originals. Static originals become watermarked AVIF when requested plus AVIF thumbnails; animated WebP/AVIF preserve original animation, skip watermarking, and keep correct MIME. Animated WebP thumbnails must be real animated WebP thumbnails; with Sharp, pass single-frame target dimensions to `resize` and use frame count only to cap the internal stacked canvas height. Use PicList / picgo-plugin-compress style conservative WebP parameters, but do not drop a valid thumbnail merely because its byte size is not smaller than the original; gallery thumbnails primarily reduce preview decode dimensions. Animated AVIF thumbnails must go through the isolated encoder adapter, try explicit/standalone/local BtbN paths before `ffmpeg-static` and system `ffmpeg`, prefer real animated AVIF thumbnails whose encoded output is verified as multi-frame, then real first-frame AVIF thumbnails, and never create placeholder thumbnails. Keep BtbN FFmpeg optional via `pnpm gallery:ffmpeg:install` or `KUN_GALLERY_FFMPEG_PATH` so default installs stay light; `ffmpeg-static` still needs target-server injection into standalone for release artifacts. If thumbnail generation or upload fails, fall back to `thumbnail_url = null`.
- Gallery remote drag import uses `app/api/edit/gallery/remote/route.ts` and `app/api/edit/galleryRemoteImport.ts`; preserve admin auth (`role >= 3`), HTTP/HTTPS-only URLs, public DNS/IP checks before every fetch and redirect, max 3 redirects, 8MB cap, and JPG/PNG/WebP/AVIF header or magic-byte validation to avoid SSRF and non-image ingestion.
- Gallery upload failures must compensate any uploaded original/real-thumbnail S3 objects and invalidate patch content cache after successful DB URL updates.
- Gallery thumbnail backfill uses `pnpm maintenance:gallery-thumbnails:dry` and `pnpm maintenance:gallery-thumbnails:apply`; dry-run must not download originals or write S3/DB, apply must only upload real thumbnails, update nullable `thumbnail_url`, compensate uploaded thumbnails on DB failure, invalidate affected patch content caches, and keep production defaults low load (`--limit=50 --batch=20 --concurrency=1 --delay=1000`).
- Gallery deletion must also clean up S3 files: rewrite submit removes un-kept images via `extractS3Key` + `deleteFileFromS3` (best-effort, log errors); full patch delete queries gallery images before cascade and cleans S3 afterwards; `DELETE /api/edit/gallery?imageId=xxx` handles single-image removal. All paths use `extractS3Key` from `app/api/patch/resource/_helper.ts`.
- Production `prisma db push` reset prompts must be cancelled and replaced with a migration plan.

## Verification

```bash
pnpm test tests/unit/api/otomegame-route-cache.test.ts
pnpm test tests/unit/redis.test.ts
pnpm test tests/unit/patch-resource-attributes.test.ts
pnpm test tests/unit/resource-link.test.ts
pnpm test tests/unit/resource-classification.test.ts
pnpm test tests/unit/gallery-thumbnail-backfill.test.ts
pnpm test tests/unit/gallery-upload.test.ts tests/unit/gallery-route.test.ts
pnpm typecheck
```
