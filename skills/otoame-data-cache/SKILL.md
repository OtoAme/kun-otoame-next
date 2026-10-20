---
name: otoame-data-cache
description: Use when changing OtoAme persistence, database structures, Redis caches, upload metadata, object storage, resource attributes, migrations, or invalidation.
---

# OtoAme Data, Cache and Uploads

Read the development entry first. Linked guides own detailed persistence guarantees.

## Required References

- [数据、缓存与上传一致性](../../docs/modules/data-cache-upload.md)
- [权限与业务规则](../../docs/modules/api-services.md)
- [本人工作台与链接维护](../../docs/modules/workspace.md)
- [数据库维护与迁移](../../docs/modules/operations.md)
- [生产部署与恢复](../../docs/project/deployment.md)
- [测试与验证](../../docs/project/testing.md)

## Critical Invariants

- Preserve stable link identity, complete edit comparisons and address-version authorization. Restore only previously revealed, current-version mirrors without extending grants or consuming quota.
- Coordinate resource, link, maintenance and case locks in the established order. Recheck ownership and state while locked; retry only recognized database conflicts, without repeating uploads or external detection.
- Keep the database client with its owning connection pool across development reloads. Long-running services must not disconnect shared infrastructure.
- Use shared accounting and database-maintained relation counts. Preserve negative balance reversals, deposit settlement and company ambiguity protections.
- Refresh every affected content, list and edge cache. Preserve personalized response isolation and time-bound public visibility; cache failures do not undo committed writes.
- Consume only registered uploads. Compensate failed saves without deleting referenced objects; persist submission cleanup obligations before deleting files, retaining them until storage and edge cleanup both succeed.
- Production changes require verified backups, reviewed migrations, prerequisite checks and compatible application rollout. Never accept a database reset or widen schema-check exceptions to conceal drift.

## Verification

Test permissions, races, cache effects and compensation. Use disposable infrastructure for real constraints and migration recovery; report unverified runtime behavior.
