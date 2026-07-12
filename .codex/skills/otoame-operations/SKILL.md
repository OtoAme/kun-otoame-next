---
name: otoame-operations
description: Use when changing kun-otoame-next scripts, migrations, GitHub Actions, PM2 config, postbuild assets, server tasks, sitemap generation, release packaging, or maintenance commands.
---

# OtoAme Operations

Use this skill for operational code and release plumbing.

## Required References

- Module guide: `docs/modules/operations.md`
- Deployment guide: `docs/project/deployment.md`
- Review guide: `docs/project/review.md`

## Rules

- Runtime assets copied by `postbuild.ts` must also be packaged in `.github/workflows/release.yml`.
- Release packaging also handles `.next/server`, `.next/BUILD_ID`, Prisma schema, and `server.js` to `server.mjs`.
- `pnpm deploy:pull` and `pnpm deploy:build` already run `git pull`.
- Production deploy paths use `pnpm prisma:deploy-safe`; reviewed preflight/sync SQL must already be applied. Development, first install, and disposable CI may continue to use `pnpm prisma:push`.
- Keep the Prisma guard read-only and the exception exact: only an empty diff or the PostgreSQL-catalog-verified Prisma 7.8 `public.patch_released_idx` operator-class false drift is allowed. Never ignore arbitrary diff output; any other drift must abort before build or standalone replacement.
- Never run the false drift's proposed `DROP INDEX` / `CREATE INDEX` SQL because it recurs after introspection and index replacement can block production writes.
- Build skip flags never replace `pnpm typecheck`.
- Check workflow branches before assuming CI covers `main` or PRs.
- Multi-instance scheduled tasks should use task locks.
- Migration scripts need dry-run/preflight behavior for production data.
- `scripts/verifyGalleryAnimatedAvifThumbnail.ts` is a local-only verification script for explicit/BtbN/`ffmpeg-static`/system FFmpeg animated AVIF gallery thumbnails; it must not connect to S3 or the database, and it must check input/output frame counts so a still first-frame AVIF is not treated as animated success. `deploy:pull` must copy target-server `node_modules/ffmpeg-static` and optional `node_modules/.ffmpeg/ffmpeg` into standalone so release artifacts do not rely on build-machine binaries.
- Gallery thumbnail backfill uses `maintenance:gallery-thumbnails:dry` before `maintenance:gallery-thumbnails:apply`; apply defaults must stay low load for production servers (`--limit=50 --batch=20 --concurrency=1 --delay=1000`) and should support scoped repeated runs.
- Private chat orphan image cleanup uses `maintenance:conversation-images:dry` before `maintenance:conversation-images:apply`; apply defaults must stay low load (`--limit=100 --batch=50 --concurrency=1 --delay=1000`) and must keep DB reference checks before S3 deletion, protecting only references from non-deleted private messages.
- Tag alias cleanup uses `maintenance:tags:auto-alias:dry` before `maintenance:tags:auto-alias:apply`; local empty tag data does not validate production impact.
- Company cleanup uses `maintenance:companies:dirty:dry` before `maintenance:companies:dirty:apply`; it merges alias duplicates, deletes zero-relation empty companies, and fixes count mismatches, while ambiguous shared aliases require manual canonical decisions.

## Verification

```bash
pnpm test tests/unit/company-merge-plan.test.ts
pnpm test tests/unit/gallery-thumbnail-backfill.test.ts
pnpm test
pnpm typecheck
pnpm build
```
