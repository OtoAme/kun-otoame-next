---
name: otoame-deployment
description: Use when changing OtoAme deployment, CI, release artifacts, runtime assets, environment configuration, PM2, or application recovery.
---

# OtoAme Deployment

Read the development entry before deployment work. The guides own executable procedures and target-environment prerequisites; never infer production state from repository files.

## Required References

- [应用部署与恢复](../../docs/guides/deployment.md)
- [数据库及维护操作](../../docs/guides/operations.md)
- [运行架构](../../docs/concepts/architecture.md)
- [验证要求](../../docs/guides/testing.md)

## Critical Invariants

Production requires reviewed migrations, verified backups and compatible application rollout. Never initialize an existing persistent database, accept a reset, widen schema-check exceptions or execute false-drift reconstruction. The production safety command includes a compatibility migration and is not wholly read-only.

Bind source, fetched release and artifact manifest to the same commit. Preserve immutable current and previous releases, operation locking, interrupted-activation recovery, three-instance readiness and loopback HTTP verification. Application rollback does not restore the database.

Package runtime assets through both build and release paths. Generate and validate database clients and platform-specific media tools on the target architecture; keep their required runtime dependencies intact.

Keep private configuration server-side, synchronize public build addresses, and preserve request-origin checks. Build skip options never replace type and test evidence; the release workflow does not run those checks.

Choose proportionate verification and report target-host or service checks that remain unperformed.
