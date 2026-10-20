---
name: otoame-api
description: Use when changing OtoAme authentication, API routes, business services, content publishing, downloads, feedback, messages, points, tags, or companies.
---

# OtoAme API

Use for business services after reading the development entry. Linked guides own detailed policy.

## Required References

- [权限与业务规则](../../docs/modules/api-services.md)
- [数据、缓存与上传一致性](../../docs/modules/data-cache-upload.md)
- [本人工作台与链接维护](../../docs/modules/workspace.md)
- [测试与验证](../../docs/project/testing.md)

## Critical Invariants

- Authenticate and check role, ownership, visibility and request origin at every callable boundary. Workspace operations remain restricted to the current account, including administrator callers.
- Keep business writes, accounting and required audit records in one transaction. Use the shared accounting service; preserve conditional available-balance checks, negative reversals and single settlement of deposits.
- Recheck state under concurrency. Losing reviews must roll back publication and settlement. Preserve unsaved edits when resource saves conflict.
- Keep link health, machine observations, user evidence and publisher maintenance independent. Never convert unknown detection into a conclusion or bypass feedback freezes through generic case actions.
- Preserve historical case participation, reporter privacy, deadline rules and deduplicated notices. Deleting a target does not close its case.
- Trust only server-registered uploads and verified external evidence. Keep credentials out of public responses, shared caches and audit summaries. Refresh all affected content and list caches.
- Report committed success accurately when later enrichment, notification, cleanup or detection fails; preserve each workflow's actual transaction boundary.

## Verification

Use focused tests for permissions, races, accounting and failure paths. Follow the testing guide; mocks do not establish real database concurrency, browser behavior or deployment success.
