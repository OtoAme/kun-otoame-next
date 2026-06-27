---
name: otoame-changelog
description: Use when writing OtoAme Chinese update logs, release notes, changelog bullets, or summarizing git ranges into user-facing release notes.
---

# OtoAme Changelog

Use this skill to turn commit ranges or change lists into the short, user-facing Chinese update log style used by OtoAme. The log is primarily for users and secondarily for release records.

## Format

- Start with `#更新日志` unless the user asks for a different heading.
- Use bullets beginning with `• `.
- Write concise Simplified Chinese. Keep each bullet short and easy to scan.
- For multi-commit ranges, prefer 4-8 bullets and combine related commits by user/admin impact.
- If two clauses can become one natural short sentence, merge them.
- Do not explain every reason or implementation detail; keep only the visible result.
- Use common verbs: `新增`, `支持`, `优化`, `修复`, `修正`, `重构`, `更新`, `补充`.
- Keep project terms stable: `VNDB`, `Bangumi`, `Steam`, `DLSite`, `sitemap`, `GitHub Actions`, `tag`, `alias`.

## Writing Rules

- Lead with the main shipped capability, bugfix, data repair, or operational ability. Fold supporting implementation work into that main result.
- Describe the finished behavior, not the path taken to build it. Avoid naming adapters, helper functions, files, commits, or libraries unless the audience needs to act on them.
- Group changes by workflow or feature area. A multi-step feature should usually become one bullet unless separate parts matter to different audiences.
- Keep deployment, compatibility, diagnostics, and preload/cache details only when they affect users, administrators, operators, or production data. Otherwise merge them into the feature summary or omit them.
- For bugfixes, name the visible inconsistency or broken workflow and the corrected result; do not expose internal cache or service details unless they explain operator action.
- For backfill, cleanup, repair, or migration work, mention it when it changes existing production data or gives operators a concrete maintenance tool.
- Remove draft markers such as `+`, parenthetical uncertainty, and implementation asides during the compression pass.

## Workflow

1. Inspect the range with `git log --oneline --reverse <base>..HEAD`.
2. Inspect `git show --stat` or `git show --name-only` for commits whose impact is unclear.
3. Group changes by visible behavior, admin operation, maintenance capability, or production risk reduction.
4. Draft the shortest useful update log from most user-visible changes to lower-level maintenance changes.
5. Do a compression pass: merge adjacent bullets in the same feature area, remove secondary clauses, and drop internal-only records.

## Selection Rules

- Do not list commits one by one.
- Omit commit hashes, file paths, test-only changes, refactors with no visible effect, and internal process changes.
- Omit docs by default; mention them only when useful to operators of a shipped feature.
- Mention maintenance scripts when production operators need to know they exist or when they repair production data.
- Prefer external behavior over implementation wording: write "修复重写游戏时..." instead of naming service functions.
- Prefer one compact bullet over multiple fine-grained bullets for the same feature.

## Example

```markdown
#更新日志
• 支持从 URL 识别 VNDB、Bangumi 和 Steam ID
• 修复重写游戏时外部信息误判重复的问题
• 优化 tag alias 处理，避免重复标签和统计错误
```
