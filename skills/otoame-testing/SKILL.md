---
name: otoame-testing
description: Use when designing, changing, running, or reviewing OtoAme tests and verification workflows.
---

# OtoAme Testing

Read the development entry first. Choose evidence according to the changed behavior and the risk it introduces.

## Required References

- [测试操作与隔离](../../docs/project/testing.md)
- [开发环境](../../docs/project/development.md)
- [质量边界](../../docs/modules/quality.md)
- [工作台与维护](../../docs/modules/workspace.md)

## Critical Invariants

For substantive regressions, establish a meaningful failing behavior test before the smallest fix. Reversible low-impact copy or styling changes need proportionate checks, not tests that mirror implementation.

Unit tests must not connect real databases, caches, storage, mail or external providers. Assert permissions, results, transaction boundaries, accounting, races, cache effects and compensation rather than merely mocked calls. Respect the runner's mock initialization rules.

Real constraints, locks and migrations require disposable infrastructure. Destructive preparation requires explicit isolated database identity and a new absolute verified backup. Never fall back to the default configuration or trust shell variables as proof of the running server's identity.

Keep write harnesses separate from read-only layout checks. Use controlled checker and storage substitutes, isolate Redis, disable external invalidations and clean only the run's own records.

Changed-test selection cannot discover every filesystem-read asset. Follow the guide for explicit contracts and broader gates; reuse still-valid passing evidence. Report actual commands and unverified browser, production or integration behavior.
