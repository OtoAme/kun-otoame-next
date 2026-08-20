---
name: otoame-deployment
description: Use when changing deployment, CI, release packaging, Next standalone output, PM2 startup, environment variables, Prisma production sync, or runtime assets in kun-otoame-next.
---

# OtoAme Deployment

Use this skill for deployment and release work.

## Required References

- Deployment guide: `docs/project/deployment.md`
- Runtime map: `docs/project/overview.md`
- Environment and local setup details: `docs/project/development.md`

## Deployment Paths

- GitHub Release artifact: `.github/workflows/release.yml` plus `pnpm deploy:pull`.
- Server local build: `pnpm deploy:build`.
- First install: `pnpm deploy:install`.

## Critical Files

- `next.config.ts`
- `scripts/postbuild.ts`
- `scripts/deployPull.ts`
- `scripts/deployBuild.ts`
- `scripts/deployInstall.ts`
- `ecosystem.config.cjs`
- `.github/workflows/release.yml`
- `prisma.config.ts`
- `prisma/schema/*`

## Rules

- `KUN_DEPLOY_BUILD_SKIP_CHECKS=true` never replaces `pnpm typecheck`.
- Any new runtime asset directory must be copied by both `postbuild.ts` and release packaging if standalone needs it.
- Any new required env var must update `validations/dotenv-check.ts`, `.env.example`, README, and GitHub Actions when build-time public.
- Animated AVIF gallery thumbnails try `KUN_GALLERY_FFMPEG_PATH`, standalone/local BtbN `.ffmpeg/ffmpeg`, bundled `ffmpeg-static`, then optional system `ffmpeg/libaom-av1`; missing support must degrade to `thumbnailUrl = null`. Keep BtbN optional via `pnpm gallery:ffmpeg:install` so default installs stay light. `ffmpeg-static` must remain in `dependencies`, `pnpm.onlyBuiltDependencies`, and `next.config.ts` `serverExternalPackages`; `deploy:pull` must inject target-server `node_modules/ffmpeg-static` into standalone because the package downloads a platform-specific binary at install time. Deployment docs should point to `scripts/verifyGalleryAnimatedAvifThumbnail.ts` for target-server preflight.
- CSRF origin/referer checks depend on `NEXT_PUBLIC_KUN_PATCH_ADDRESS_DEV` and `NEXT_PUBLIC_KUN_PATCH_ADDRESS_PROD`.
- Release packages rename `server.js` to `server.mjs`; keep PM2 and deploy scripts compatible with both.
- Prisma schema changes need target-side client generation and a production data plan when destructive or large.
- Production `pnpm deploy:pull` and `pnpm deploy:build` paths must use `pnpm prisma:deploy-safe`; reviewed preflight/sync SQL must already be applied to the target database.
- Keep the production guard read-only for Prisma schema: accept only an empty diff or the exact, PostgreSQL-catalog-verified Prisma 7.8 `public.patch_released_idx` operator-class exception. Never broaden it to ignore arbitrary diff output; any other drift must abort before build or standalone replacement.
- Never execute the false drift's proposed `DROP INDEX` / `CREATE INDEX` SQL; it recurs after the next introspection and index replacement can block writes. Development, first install, and disposable CI may continue to use `pnpm prisma:push`.
- `pnpm deploy:pull` and `pnpm deploy:build` already run `git pull`; do not duplicate that step unless handling conflicts manually.
- Missing `patch_resource_access` uses `migration/production-resource-access-bootstrap-preflight-2026-07-12.sql` before the grant pair; stop old PM2 instances through Guard completion and pin the reviewed artifact with command-scoped `KUN_DEPLOY_RELEASE_TAG`.
- Do not use destructive git rollback commands unless explicitly requested.
- Check workflow branches; release currently targets `main`, lint currently targets `master`.

## Verification

Prefer:

```bash
pnpm typecheck
pnpm test
pnpm build
```

For script-only edits, also inspect the exact shell commands they execute and whether they assume files copied into `.next/standalone`.
