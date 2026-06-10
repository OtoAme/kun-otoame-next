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
- Build skip flags never replace `pnpm typecheck`.
- Check workflow branches before assuming CI covers `main` or PRs.
- Multi-instance scheduled tasks should use task locks.
- Migration scripts need dry-run/preflight behavior for production data.
- Tag alias cleanup uses `maintenance:tags:auto-alias:dry` before `maintenance:tags:auto-alias:apply`; local empty tag data does not validate production impact.

## Verification

```bash
pnpm test
pnpm typecheck
pnpm build
```
