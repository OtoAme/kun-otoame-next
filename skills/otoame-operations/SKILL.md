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
- Latest deploy uses a locked fast-forward pull; pinned deploy only fetches `KUN_DEPLOY_RELEASE_TAG` and never pulls or checks out.
- Production deploy paths use `pnpm prisma:deploy-safe`; reviewed preflight/sync SQL must already be applied. Development, first install, and disposable CI may continue to use `pnpm prisma:push`.
- Keep the Prisma guard read-only and the exception exact: only an empty diff or the PostgreSQL-catalog-verified Prisma 7.8 `public.patch_released_idx` operator-class false drift is allowed. Never ignore arbitrary diff output; any other drift must abort before build or standalone replacement.
- Never run the false drift's proposed `DROP INDEX` / `CREATE INDEX` SQL because it recurs after introspection and index replacement can block production writes.
- Build skip flags never replace `pnpm typecheck`.
- Check workflow branches before assuming CI covers `main` or PRs.
- Keep `pnpm dev` bound to localhost for the default local workflow; document LAN-facing development variants such as `pnpm dev:lan` as opt-in debugging commands that listen on `0.0.0.0`.
- Multi-instance scheduled tasks should use task locks.
- Migration scripts need dry-run/preflight behavior for production data.
- Patch-submission production preflight must stay read-only, independently skip row checks when either submission table is absent, and report defaults that conflict with Prisma `@updatedAt`. The sync creates those columns without defaults and idempotently drops legacy defaults. Docker-hosted PostgreSQL rollout uses `docker exec -i` for redirected SQL, a verified host-side `pg_dump` after PM2 stops, ordered syncs, repeated preflights as postflight, and a pinned Release; never substitute production `prisma:push`.
- Moemoepoint ledger rollout must run `production-moemoepoint-ledger-preflight-2026-08-17.sql`, then the reviewed sync, then `pnpm prisma:deploy-safe` before starting code that depends on the new tables; do not roll the application back alone while writes are live because older code bypasses the ledger.
- Resource-access missing-table rollout starts with `migration/production-resource-access-bootstrap-preflight-2026-07-12.sql`; keep bootstrap manual, finish hardened Steam sync first, and pin high-risk deploys with command-scoped `KUN_DEPLOY_RELEASE_TAG`.
- `scripts/verifyGalleryAnimatedAvifThumbnail.ts` is a local-only verification script for explicit/BtbN/`ffmpeg-static`/system FFmpeg animated AVIF gallery thumbnails; it must not connect to S3 or the database, and it must check input/output frame counts so a still first-frame AVIF is not treated as animated success. `deploy:pull` must copy target-server `node_modules/ffmpeg-static` and optional `node_modules/.ffmpeg/ffmpeg` into standalone so release artifacts do not rely on build-machine binaries.
- Gallery thumbnail backfill uses `maintenance:gallery-thumbnails:dry` before `maintenance:gallery-thumbnails:apply`; apply defaults must stay low load for production servers (`--limit=50 --batch=20 --concurrency=1 --delay=1000`) and should support scoped repeated runs.
- Private chat orphan image cleanup uses `maintenance:conversation-images:dry` before `maintenance:conversation-images:apply`; apply defaults must stay low load (`--limit=100 --batch=50 --concurrency=1 --delay=1000`) and must keep DB reference checks before S3 deletion, protecting only references from non-deleted private messages.
- Submission asset maintenance uses `maintenance:submission-assets:dry` before `maintenance:submission-assets:apply`. Dry-run must remain read-only. Apply processes terminal submission-row outboxes, persisted orphan jobs, then newly discovered S3 orphans; persist each new orphan key and all current purge URLs before deletion, re-check live references at execution, and retain failed jobs for retry. Production must install the `patch_submission_orphan_cleanup` schema before deploying code that writes it.
- `cleanupSubmissionAssetsTask` runs the same engine at 04:00 Asia/Shanghai with `apply: false`, local no-overlap, and an 8-hour multi-instance lock. Register/start it only through `server/cron.ts`; never call the dependency `close()` from the resident task because it disconnects shared Prisma.
- Tag alias cleanup uses `maintenance:tags:auto-alias:dry` before `maintenance:tags:auto-alias:apply`; local empty tag data does not validate production impact.
- Company cleanup is frozen: inventory → human decisions → plan → dry → apply → cache. Only plan may call VNDB. Apply requires the exact SHA, locks all company state, rejects drift before writes, and emits a receipt. Cache retry verifies the complete post-state. Zero relations never imply deletion; decisions and plan must explicitly name it.
- Keep private inventory, decisions, plan, sidecar, receipt, logs, and verified backup outside repositories/worktrees.
- Six statement-level transition-table triggers exclusively own tag/company counts. Application and maintenance code never adjusts them. Sync locks both relation tables before backfill; rollback pauses relation writes first.
- Phase A precedes dependent code. Phase B requires a continuous write pause, fresh frozen cleanup, constraint migration/postflight, candidate guard, flag-on smoke tests, and reviewed rollback/postflight.
- Deployment uses manifest-bound immutable slots, journal, lock, PM2/HTTP readiness, and offline previous-slot rollback. Manifest-less R1/R3 remains manual.

## Verification

```bash
pnpm test tests/unit/company-cleanup-frozen-planner.test.ts
pnpm test tests/unit/gallery-thumbnail-backfill.test.ts
pnpm test
pnpm typecheck
pnpm build
```
