---
name: otoame-frontend
description: Use when changing or reviewing kun-otoame-next App Router pages, React components, Zustand stores, theme tokens, MDX content rendering, editors, navigation, NSFW UI, HeroUI controls, or user-facing frontend workflows. Enforces HeroUI v2-first component composition, accessibility, and theme integration.
---

# OtoAme Frontend

Use this skill for pages, components, state, theme, and content.

## Required References

- `docs/modules/app-router.md` — 首页, 用户与消息页面, 标签和公司详情页
- `docs/modules/frontend-content.md` — 资源详情与下载, 萌萌点, 消息展示, 状态管理, 主题与样式, 投稿页面
- `docs/modules/private-chat-stickers.md` — 管理后台
- `docs/theme-color-system.md` — `--kun-*` / `--kun-chat-*` tokens

## HeroUI v2 Baseline

- HeroUI v2 is the mandatory design system. Read the `@heroui/react` version from `package.json` and check current v2 docs through Context7; never apply v3 APIs.
- Pick building blocks in order: existing project component → HeroUI v2 component → composed HeroUI primitives → native/custom only when HeroUI has no v2 capability. Justify exceptions at handoff.
- Never rebuild buttons, form controls, tabs, cards, chips, badges, tables, pagination, loading states, menus, tooltips, popovers, drawers or dialogs from raw elements plus Tailwind.
- Preserve React Aria behavior: documented props and slots, labels, errors, keyboard interaction, focus visibility and restoration, disabled/loading semantics, overlay dismissal.
- Customize in order: props and variants → `className` / `classNames` slots → HeroUI theme tokens → project `--kun-*` tokens. Never fork HeroUI markup, target generated class names, or scatter one-off `dark:` fixes. Keep layouts responsive, touch-safe and `prefers-reduced-motion` aware.

## Rules

- Frontend gating is UX only; the API must re-check every permission.
- Download credentials (`content`, `code`, `password`) live only in component memory — never in stores, persisted state, URLs or caches.
- State-changing requests use `utils/kunFetch.ts` (CSRF header); surface its string business errors, never swallow them.
- Author submission forms mutate only in `draft` and `changes_requested`; other statuses disable every mutation and external-fetch control.
- Submission review actions live only on `/admin/submission/[id]`; self-review needs an explicit super-admin override.
- A failed gallery upload must never clear the localforage draft or navigate away; keep failures retryable.
- Submission autosave is one serial promise chain reading `revision` at execution time; save, submit and preview stop on a failed `flush()`. Never retry a real conflict.
- Public `force-static` pages must not become dynamic to read cookies; theme repair belongs in `SiteThemeScript` / `SiteThemeRouteSync` / `useKunSiteTheme`.
- Moemoepoint balances can be negative — danger semantics, never clamp to 0.
- Polling, hydration and pagination must not overlap or let stale responses overwrite newer state.
- Destructive actions need confirmation and must release loading state on failure.

## Verification

```bash
pnpm test tests/unit/<target>.test.ts   # while iterating
pnpm test:changed && pnpm typecheck     # default commit gate
pnpm test                               # checkpoints — see docs/modules/quality.md
```
