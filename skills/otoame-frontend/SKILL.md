---
name: otoame-frontend
description: Use when changing OtoAme pages, components, state, themes, editors, navigation, content rendering, or user interaction.
---

# OtoAme Frontend

Read the development entry before frontend work. Select the interface system by the page root and preserve server authorization independently of controls.

## Required References

- [页面边界](../../docs/reference/pages.md)
- [前端与内容](../../docs/reference/frontend.md)
- [用户工作台](../../docs/reference/workspace.md)
- [主题系统](../../docs/reference/theme.md)
- [私聊贴纸](../../docs/reference/stickers.md)
- [测试与浏览器验收](../../docs/guides/testing.md)

## Critical Invariants

Site, legacy admin and previews use HeroUI v2; dashboard and workspace use shadcn with isolated styles.

For every frontend task, inspect project components, then check official UI options through Context7 before implementation. Reuse, add or compose suitable components; local absence never justifies rebuilding. Native/system controls or handwritten HTML/CSS replacements require evidence that reuse and composition cannot meet requirements.

Keep labels, keyboard access, focus, loading, errors, reduced motion and responsive layouts functional.

Treat mobile and accessibility as baseline requirements, not previously proven facts. Check affected narrow and desktop views plus relevant breakpoints and overlays.

Keep sensitive download credentials only in component memory. Preserve failed drafts, complete edit comparisons, serial submission saves and current-target response isolation. Never automatically overwrite a real conflict. Confirmation dismissal must produce no writes.

Use server capabilities for case and health actions. Keep notification and chat unread state separate; deleted messages must release old content. Respect private previews, content visibility, negative balances and each media component's actual playback behavior.

Follow the testing guide and state precisely which browsers and interactions were checked. Component tests alone do not establish layout correctness.
