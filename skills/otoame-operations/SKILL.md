---
name: otoame-operations
description: Use when changing OtoAme maintenance scripts, migrations, scheduled tasks, release packaging, sitemap generation, or operational commands.
---

# OtoAme Operations

Read the development entry first. Operational guides own the complete command, backup, migration and recovery sequence.

## Required References

- [运维操作](../../docs/guides/operations.md)
- [应用发布与恢复](../../docs/guides/deployment.md)
- [工作台维护](../../docs/reference/workspace.md)
- [审阅风险](../../docs/guides/review.md)

## Critical Invariants

Confirm target identity and authorization before writes. Production changes require reviewed prechecks, verified backups, ordered synchronization and postchecks. Never replace migrations with persistent-database initialization or widen permitted schema drift.

Preserve writer compatibility, link-health clocks, maintenance freezes and historical participation. Scheduled tasks use appropriate distributed locks; failed acquisition skips work. Submission asset scheduling audits only and must not delete objects or disconnect shared infrastructure.

Use dry previews before cleanup. Protect live references, persist submission cleanup obligations before deletion, and settle only after storage and edge confirmation. Keep production batches conservative.

Company cleanup consumes the exact reviewed frozen plan and matching state; no implicit deletion, replanning or automatic unmerge. Database triggers alone maintain relation counts. Keep private plans, receipts and backups outside repositories.

Preserve manifest-bound release activation and target readiness. Shared caching is limited to controlled anonymous responses with personalized and framework-data bypasses. Verify actual edge behavior rather than trusting purge acceptance.

Report static and runtime checks separately; source availability grants no production action.
