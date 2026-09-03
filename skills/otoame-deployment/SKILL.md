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
- `pnpm deploy:pull` uses a locked fast-forward pull; `pnpm deploy:pull:pinned` fetches only the command-scoped `KUN_DEPLOY_RELEASE_TAG` and never pulls or checks out. `pnpm deploy:build` also fast-forwards under the deployment lock.
- `deploy:pull` must not run `prisma generate --schema=<candidate>`: Prisma resolves the CLI and `@prisma/client` upwards from the schema directory and requires them in one `node_modules`, and a candidate below the project root always resolves the CLI from the root ("Could not resolve @prisma/client"). Instead assert the candidate `prisma/schema` is byte-identical to the checked-out schema, run `prisma generate` at the root, copy the generated `.prisma` plus the real `@prisma/client` package and its declared dependencies (`@prisma/client-runtime-utils`) into the candidate, and assert `node_modules/.prisma/client` exists there.
- A flattened `@prisma/client` copy without `@prisma/client-runtime-utils` fails at runtime under pnpm; preflight `require('@prisma/client')` from the candidate root before PM2 starts.
- pnpm standalone layouts have no top-level `react-dom`: the runtime validator resolves `react`/`react-dom` from the release's `next` package and requires the result inside the release instead of copying packages into candidates. Legacy adoption copies symlinks verbatim (`cpSync` otherwise rewrites relative links to absolute paths under `.next/standalone`) and rewrites such absolute links on already adopted releases; never delete `.deploy/releases/legacy-initial` by hand.
- Missing `patch_resource_access` uses `migration/production-resource-access-bootstrap-preflight-2026-07-12.sql` before the grant pair; stop old PM2 instances through Guard completion and pin the reviewed artifact with command-scoped `KUN_DEPLOY_RELEASE_TAG`.
- Patch-submission rollout uses the three reviewed preflight/sync pairs in the documented order. The base preflight must remain read-only, guard `patch_submission` and `patch_submission_gallery` independently so first installs and interrupted partial installs do not query missing tables, and require no database default on Prisma `@updatedAt` columns. For containerized PostgreSQL, pipe host SQL through `docker exec -i ... psql -X -v ON_ERROR_STOP=1`; take and verify a host-side custom-format dump after stopping PM2, rerun every preflight as postflight, then run `pnpm prisma:deploy-safe` and the pinned Release deployment.
- Do not use destructive git rollback commands unless explicitly requested.
- `release.yml` (targets `main`) is the only workflow; CI runs no tests. Keep the upstream `lint-check.yml` deleted if a sync brings it back — it targets `master` and never fires here.
- Artifacts contain a strict manifest. Both pull modes require `HEAD = fetched tag commit = manifest commit` before activation.
- Guard and generate against the candidate Prisma schema before replacing root schema or runtime state; candidate failure leaves the active release intact.
- Immutable runtimes live in `.deploy/releases`; current/previous are atomic links and `.next/standalone` is compatibility-only. Journal and operation lock fail closed.
- Activation requires exactly three candidate PM2 instances and loopback HTTP 2xx/3xx. Failure restores and verifies the old release.
- `pnpm deploy:rollback` recovers an interrupted activation or switches to the verified previous slot without changing Git or database. Manifest-less R1/R3 artifacts remain manual snapshots.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm build
```

For script-only edits, also inspect the exact shell commands they execute and whether they assume files copied into `.next/standalone`.
