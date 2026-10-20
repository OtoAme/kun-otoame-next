---
name: otoame-changelog
description: Use when writing OtoAme Chinese user-facing update logs or release notes from a verified change range.
---

# OtoAme Changelog

Use this skill for concise Chinese release notes. Read the development entry first; maintenance documentation uses the documentation skill.

## Required References

- [文档与事实标准](../../docs/project/documentation.md)
- [验证与交付边界](../../docs/modules/quality.md)
- [项目介绍](../../README.md)

## Writing Rules

Inspect the requested range and unclear changes before drafting. Describe the completed user or operator result, grouped by workflow rather than one bullet per commit. Verify release scope; repository implementation alone does not prove production availability.

Unless the user chooses another format, begin with #更新日志 and use • followed by a space for each bullet. Prefer four to eight short bullets for a substantial range. Use clear verbs for additions, support, fixes and visible improvements, keeping established product names.

Lead with shipped capabilities and corrected behavior. Combine supporting work into its main result. Include migration, compatibility, maintenance or diagnostics only when users or operators must act or existing data changes.

Omit internal helpers, hashes, paths, test-only work, speculative benefits, draft markers and abandoned approaches. Keep technical implementation out of user prose; do not hide it in a reference section. Remove uncertain claims rather than announcing them as released.

A changelog draft does not authorize publishing or sending messages. Follow the user's destination and existing authorization, and report any unverified release boundary.
