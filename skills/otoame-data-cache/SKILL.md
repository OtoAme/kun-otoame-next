---
name: otoame-data-cache
description: Use when changing kun-otoame-next Prisma schema, database access, Redis cache, upload metadata, S3 resources, patch resource attributes, migrations, or cache invalidation behavior.
---

# OtoAme Data Cache

Use this skill for persistence, cache, and upload consistency work.

## Required References

- `docs/modules/data-cache-upload.md` — Prisma, Redis, Patch 缓存, 上传与 S3, 投稿素材的 key 布局, 资源派生属性, 下载授权与事件
- `docs/modules/operations.md` — 迁移策略, 维护脚本
- `docs/project/testing.md`

## Rules

- Production never runs `prisma db push`. Cancel any "reset the database" prompt; run the reviewed preflight/sync SQL, then `pnpm prisma:deploy-safe`.
- That guard accepts only an empty diff or the catalog-verified `public.patch_released_idx` operator-class false drift — never widen it, never run its proposed `DROP INDEX` / `CREATE INDEX`.
- Every balance change goes through the moemoepoint service in the owning transaction. Only `moemoepoint_reserved` has a non-negative CHECK; never clamp a reversal.
- Call the matching invalidation helper after every patch/resource/tag/company write, including the patch content cache for company-relation writes.
- `patch_tag.count` and `patch_company.count` are maintained only by the six statement-level relation triggers. Application and maintenance code must never increment, decrement, or absolutely repair them; relation helpers return changed IDs only for cache invalidation.
- Phase B company identity uses `patch_company.normalized_name NOT NULL UNIQUE` and a unique `(source, external_id)` pair. Cross-company alias identities remain non-unique. Every company create path must derive `normalized_name` through the shared normalization/helper path, and production installs these constraints only through the reviewed constraint preflight/sync/postflight SQL.
- Pass helper keys unprefixed; direct `redis` / `runRedisCommand` needs an explicit full prefix.
- Never delete an S3 object before its durable cleanup credential exists: `patch-submission/` deletes upsert `patch_submission_orphan_cleanup` in the same short DB transaction; `published` keys never enter cleanup.
- Patch-domain deletes resolve keys only through `extractS3Key` (exact configured bases, lookalike hosts rejected); conversation images and the gallery backfill keep their own dedicated, stricter resolvers.
- Upload publishing keeps `consumeUpload` → S3 → `finalizeUpload` with compensation on every failure path.
- Action rate limits fail open on Redis errors; the image hourly quota fails closed — never unmetered S3 writes.

## Verification

```bash
pnpm test tests/unit/<target>.test.ts   # while iterating
pnpm test:changed && pnpm typecheck     # default commit gate
pnpm test                               # checkpoints — see docs/modules/quality.md
```
