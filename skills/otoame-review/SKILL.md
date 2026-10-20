---
name: otoame-review
description: Use when reviewing OtoAme code, documentation, tests, data changes, uploads, authorization, cache behavior, or release risk.
---

# OtoAme Review

Read the development entry first. Review changed behavior and necessary dependencies within the user's scope; do not turn every change into a whole-system rewrite or multi-model review.

## Required References

- [审阅指南](../../docs/project/review.md)
- [模块路线](../../docs/modules/index.md)
- [质量与证据](../../docs/modules/quality.md)
- [验证操作](../../docs/project/testing.md)
- [文档标准](../../docs/project/documentation.md)

## Critical Invariants

Prioritize authorization, privacy, data integrity, accounting, concurrency, cache correctness, upload compensation and release compatibility. Check server boundaries independently of frontend visibility. Protect credentials, historical participation and live file references.

Use current source and meaningful tests as evidence; mock success cannot establish real constraints, browser behavior or production deployment. High-risk operations require reviewed prerequisites, backups and supported recovery conditions. Application rollback alone does not undo data changes.

For documentation, verify each new explanation and task step, preserve critical business limits and keep implementation inventories out of prose. Mechanical checks are not factual review.

Report blocking findings first with a concrete trigger, consequence, source and minimum correction. Separate optional improvements and remaining questions. Recheck accepted fixes and their effects, expanding only for newly evidenced serious risks.

When no findings remain, say so and name unperformed checks. Review authority does not grant production writes, source transfers, publication or deployment.
