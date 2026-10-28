---
name: otoame-documentation
description: Use when writing, editing, restructuring, or reviewing OtoAme maintenance documentation and project guidance.
---

# OtoAme Documentation

Use this skill for maintained project prose. User release notes use the changelog skill. Read the development entry first and follow the documentation standard as the main writing authority.

## Required References

- [文档标准](../../docs/guides/documentation.md)
- [按任务导航](../../docs/README.md)
- [文档检查操作](../../docs/guides/testing.md)

## Critical Invariants

Organize each page around a reader task. Explain who acts, under which conditions, and what result and limits follow. Preserve permissions, privacy, amounts, quotas, deadlines, concurrency and recovery conditions.

Use natural language throughout explanatory prose. Only operational guides retain commands and configuration necessary for their task. Never paste program implementations, SQL bodies or styling examples, or list inventories of functions and internal fields; name a key function, setting or file when tracing requires it. Link precise source locations with descriptive Chinese labels.

Verify new explanations and failure handling against current evidence. Distinguish implementation, approved requirements and actual deployment; historical tests do not establish current operation. Put unsupported gaps in the delivery report, not unfinished prose.

Maintain one primary home for each important fact and update navigation and incoming links. Replace superseded rules instead of appending contradictory exceptions. Separate review of substantial rewrites and high-risk instructions is optional and decided by the site owner.

Mechanical checks verify local structure, not factual accuracy or usability. Report checks, evidence and remaining limits.
