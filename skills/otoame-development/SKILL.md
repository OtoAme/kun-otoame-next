---
name: otoame-development
description: Use when developing, documenting, reviewing, or maintaining any part of the OtoAme repository.
---

# OtoAme Development

Use this entry skill before domain work. Project skills have one source under the repository skills directory; tool discovery links must not become separate copies. Read the matching domain skill and its references before exploring or editing code.

## Required References

- [项目架构](../../docs/concepts/architecture.md)
- [开发与授权边界](../../docs/guides/development.md)
- [参考索引](../../docs/reference/README.md)
- [质量与交付](../../docs/concepts/quality.md)
- [验证操作](../../docs/guides/testing.md)

## Critical Invariants

Authorization, privacy and sensitive-file boundaries are defined once in the [collaboration guide](../../AGENTS.md); read required references to the depth that guide sets for the task's risk.

Keep server authorization, business transactions, accounting, upload compensation and cache invalidation intact. Preserve compatibility identifiers. Use Conventional Commits; review documentation and skills after code changes and commit their synchronization separately.

Choose proportionate checks from the testing guide. Report actual results and unverified risks without claiming runtime success from static review.
