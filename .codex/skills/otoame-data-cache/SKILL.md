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
- After schema changes run `pnpm prisma:push` or `pnpm prisma:generate`.
- Use `lib/redis.ts`; helper keys are unprefixed because the helper adds `kun:touchgal`.
- Direct `redis` / `runRedisCommand` usage needs a reason and explicit full key prefixes.
- After patch/resource/tag/company writes, call the matching cache invalidation helper.
- Anonymous tag/company game-list APIs use short response caches; never cache personalized login/NSFW/blocked-tag results, and keep Redis list cache keys scoped by the full visibility where.
- Home `home_data:*` and `/api/home` anonymous response caches must not store empty `galgames` payloads; this is a deploy/ISR empty-snapshot guard, not a generic rule for valid empty paginated lists.
- Upload publishing must preserve role/quota checks, `consumeUpload`, S3 compensation, `finalizeUpload`, and cleanup behavior.
- Gallery upload uses `app/api/edit/galleryUpload.ts`: originals stay at `patch/{patchId}/gallery/{imageId}.{ext}`, thumbnails at `patch/{patchId}/gallery/thumbnail/{imageId}.{thumbExt}` only when a real thumbnail exists. Static originals become watermarked AVIF when requested plus AVIF thumbnails; animated WebP/AVIF preserve original animation, skip watermarking, and keep correct MIME. Animated WebP thumbnails must be real animated WebP thumbnails; with Sharp, pass single-frame target dimensions to `resize` and use frame count only to cap the internal stacked canvas height. Use PicList / picgo-plugin-compress style conservative WebP parameters, but do not drop a valid thumbnail merely because its byte size is not smaller than the original; gallery thumbnails primarily reduce preview decode dimensions. If thumbnail generation or upload fails, fall back to `thumbnail_url = null`. Animated AVIF v1 must not create placeholder thumbnails.
- Gallery upload failures must compensate any uploaded original/real-thumbnail S3 objects and invalidate patch content cache after successful DB URL updates.
- Production `prisma db push` reset prompts must be cancelled and replaced with a migration plan.

## Verification

```bash
pnpm test tests/unit/api/otomegame-route-cache.test.ts
pnpm test tests/unit/redis.test.ts
pnpm test tests/unit/resource-link.test.ts
pnpm test tests/unit/resource-classification.test.ts
pnpm test tests/unit/gallery-upload.test.ts tests/unit/gallery-route.test.ts
pnpm typecheck
```
