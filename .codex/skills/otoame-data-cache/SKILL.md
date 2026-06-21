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
- Upload publishing must preserve role/quota checks, `consumeUpload`, S3 compensation, `finalizeUpload`, and cleanup behavior.
- Prisma interactive transactions must stay short; do not run S3 uploads, sharp image processing, HTTP fetches, IndexNow, or VNDB/Bangumi/Steam/DLSite network calls inside transaction callbacks.
- Patch banner upload returns `{ imageLink, uploadedKeys }`; create publish failures after upload must call `cleanupUploadedPatchBanner(uploadedKeys)` and delete the hidden patch.
- Public patch cache/list/detail reads must exclude `PATCH_STATUS_PUBLISHING` and other non-visible states by filtering `PATCH_STATUS_VISIBLE`.
- Production `prisma db push` reset prompts must be cancelled and replaced with a migration plan.

## Verification

```bash
pnpm test tests/unit/redis.test.ts
pnpm test tests/unit/resource-link.test.ts
pnpm test tests/unit/resource-classification.test.ts
pnpm typecheck
```
